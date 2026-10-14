import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { formatUnits, type Address } from "viem";
import { z, ZodError } from "zod";
import type { AppEnvironment, Bindings } from "./env";
import { auth, isOperator } from "./auth";
import { ApiError, requireConfig } from "./http";
import { circle, ensureWallet, verifyCircleWebhook, rpc } from "./circle";
import {
  publicClaim,
  reconcileClaim,
  reconcileClaims,
  reserveClaim,
} from "./claims";
import { reconcileOperations } from "./operations";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerSpendRoutes, reconcileSpends } from "./spends";
import { registerEventRoutes } from "./routes/events";
import { registerAdminRoutes } from "./routes/admin";
import type { ClaimRow } from "./db";
const claimInput = z.object({
  spotId: z.string().uuid(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0),
      timestamp: z.number().int().positive(),
    })
    .optional(),
  proof: z.string().max(1000).optional(),
});
export function createApp() {
  const app = new Hono<AppEnvironment>();
  app.use("*", bodyLimit({ maxSize: 131072 }));
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.path.startsWith("/v1")) c.header("Cache-Control", "no-store");
  });
  app.onError((error, c) => {
    if (error instanceof ApiError)
      return c.json({ error: error.code }, error.status);
    if (error instanceof ZodError || error instanceof SyntaxError)
      return c.json({ error: "INVALID_REQUEST" }, 400);
    console.error(
      JSON.stringify({
        event: "api_error",
        path: c.req.path,
        kind: error.name,
        code: "code" in error ? error.code : undefined,
      }),
    );
    return c.json({ error: "SERVICE_UNAVAILABLE" }, 503);
  });
  app.get("/health", (c) => c.json({ status: "ok", network: "arc-mainnet" }));
  app.all("/v1/auth/*", async (c) => {
    if (
      !(await c.env.AUTH_LIMIT.limit({
        key: c.req.header("CF-Connecting-IP") || "local",
      }).then((r) => r.success))
    )
      throw new ApiError("RATE_LIMITED", 429);
    requireConfig(c.env.BETTER_AUTH_SECRET, "AUTH");
    return auth(c.env).handler(c.req.raw);
  });
  app.post("/v1/webhooks/circle", async (c) => {
    const raw = await c.req.text();
    const signature = c.req.header("X-Circle-Signature") || "";
    const keyId = c.req.header("X-Circle-Key-Id") || "";
    // Acknowledge unsigned subscription setup probes without processing them.
    // Unsigned requests never touch D1 or reconcile transactions.
    if (!signature && !keyId) return c.body(null, 204);
    if (
      !(await verifyCircleWebhook(
        c.env,
        raw,
        signature,
        keyId,
      ))
    )
      throw new ApiError("INVALID_SIGNATURE", 401);
    const message = z
      .object({
        notificationId: z.string().uuid(),
        subscriptionId: z.string().uuid(),
        version: z.literal(2),
        notification: z.object({ id: z.string().uuid() }).passthrough(),
      })
      .parse(JSON.parse(raw));
    if (
      message.subscriptionId !==
      requireConfig(
        c.env.CIRCLE_WEBHOOK_SUBSCRIPTION_ID,
        "WEBHOOK_SUBSCRIPTION",
      )
    )
      throw new ApiError("INVALID_SUBSCRIPTION", 403);
    if (
      await c.env.DB.prepare("SELECT id FROM webhook WHERE id = ?")
        .bind(message.notificationId)
        .first()
    )
      return c.json({ received: true });
    const claim = await c.env.DB.prepare(
      "SELECT * FROM claim WHERE transaction_id = ?",
    )
      .bind(message.notification.id)
      .first<ClaimRow>();
    if (claim) await reconcileClaim(c.env, claim);
    await reconcileOperations(c.env);
    await reconcileSpends(c.env);
    await c.env.DB.prepare(
      "INSERT INTO webhook (id,received_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(message.notificationId, Date.now())
      .run();
    return c.json({ received: true });
  });
  registerEventRoutes(app);
  app.use("/v1/*", async (c, next) => {
    requireConfig(c.env.BETTER_AUTH_SECRET, "AUTH");
    const session = await auth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session || !session.user.emailVerified)
      throw new ApiError("SIGN_IN_REQUIRED", 401);
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      c.req.header("Origin") !== c.env.APP_ORIGIN
    )
      throw new ApiError("INVALID_ORIGIN", 403);
    c.set("user", session.user);
    c.set("sessionCreatedAt", new Date(session.session.createdAt).getTime());
    await next();
  });
  app.get("/v1/me", (c) =>
    c.json({
      user: { id: c.get("user").id, email: c.get("user").email },
      operator: isOperator(c.env, c.get("user").email),
    }),
  );
  app.post("/v1/wallet", async (c) =>
    c.json({ wallet: await ensureWallet(c.env, c.get("user").id) }),
  );
  app.get("/v1/wallet", async (c) => {
    const wallet = await c.env.DB.prepare(
      "SELECT wallet_id,address FROM wallet WHERE user_id = ?",
    )
      .bind(c.get("user").id)
      .first<{ wallet_id: string | null; address: string | null }>();
    const claims = (
      await c.env.DB.prepare(
        "SELECT * FROM claim WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(c.get("user").id)
        .all<ClaimRow>()
    ).results.map(publicClaim);
    if (!wallet?.wallet_id)
      return c.json({ wallet: null, balance: "0", claims });
    const nativeBalance = await rpc(c.env).getBalance({
      address: wallet.address as Address,
    });
    const balance = formatUnits(nativeBalance, 18);
    return c.json({
      wallet: { address: wallet.address },
      balance,
      balanceUnits: (nativeBalance / 10n ** 12n).toString(),
      claims,
    });
  });
  app.use("/v1/claims/*", async (c, next) => {
    if (
      !(await c.env.CLAIM_LIMIT.limit({ key: c.get("user").id }).then(
        (r) => r.success,
      ))
    )
      throw new ApiError("RATE_LIMITED", 429);
    await next();
  });
  app.post("/v1/claims", async (c) => {
    if (
      !(await c.env.CLAIM_LIMIT.limit({ key: c.get("user").id }).then(
        (r) => r.success,
      ))
    )
      throw new ApiError("RATE_LIMITED", 429);
    const input = claimInput.parse(await c.req.json());
    const claim = await reserveClaim(
      c.env,
      c.get("user").id,
      input.spotId,
      input.location,
      input.proof,
    );
    c.executionCtx.waitUntil(
      reconcileClaim(c.env, claim).catch(() =>
        console.error(
          JSON.stringify({
            event: "claim_submission_pending",
            claimId: claim.id,
          }),
        ),
      ),
    );
    return c.json(
      { claim: publicClaim(claim) },
      claim.status === "confirmed" ? 200 : 202,
    );
  });
  app.get("/v1/claims/:id", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT * FROM claim WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<ClaimRow>();
    if (!row) throw new ApiError("CLAIM_NOT_FOUND", 404);
    c.executionCtx.waitUntil(
      reconcileClaim(c.env, row).catch(() =>
        console.error(
          JSON.stringify({ event: "claim_poll_pending", claimId: row.id }),
        ),
      ),
    );
    return c.json({ claim: publicClaim(row) });
  });
  registerCampaignRoutes(app);
  registerSpendRoutes(app);
  registerAdminRoutes(app);
  app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
  return app;
}
const app = createApp();
export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      Promise.all([
        reconcileClaims(env),
        reconcileOperations(env),
        reconcileSpends(env),
      ]).then(() => undefined),
    );
  },
};
