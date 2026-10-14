import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../env";
import { eventInput } from "./admin";
import { availableSlug } from "../slugs";
import { ApiError } from "../http";
import { ensureWallet } from "../circle";
import { encryptProof, decryptProof, proofHash } from "../proofs";
import { startOperation, reconcileOperation } from "../operations";
import {
  fundingQuote,
  requireRecentAuth,
  sufficientBalance,
  maximumFee,
} from "../spends";
import type { EventRow, OperationRow } from "../db";
const input = eventInput.and(
  z.object({
    kind: z.enum(["map", "code", "qr", "puzzle", "prize"]),
    singleClaim: z.boolean().default(true),
    proofs: z
      .array(
        z.object({
          answer: z.string().trim().min(1).max(500).optional(),
          clue: z.string().max(1000).default(""),
          email: z.email().optional(),
        }),
      )
      .max(100)
      .optional(),
  }),
);
export function registerCampaignRoutes(app: Hono<AppEnvironment>) {
  app.get("/v1/campaigns", async (c) => {
    const events = (
      await c.env.DB.prepare(
        "SELECT * FROM event WHERE creator_id = ? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(c.get("user").id)
        .all()
    ).results;
    const operations = (
      await c.env.DB.prepare(
        "SELECT operation.* FROM operation JOIN event ON event.id = operation.event_id WHERE event.creator_id = ? ORDER BY operation.created_at DESC LIMIT 100",
      )
        .bind(c.get("user").id)
        .all<OperationRow>()
    ).results;
    c.executionCtx.waitUntil(
      Promise.all(
        operations
          .filter((op) => op.status === "pending")
          .map((op) => reconcileOperation(c.env, op).catch(() => undefined)),
      ),
    );
    return c.json({ events, operations });
  });
  app.post("/v1/campaigns", async (c) => {
    const value = input.parse(await c.req.json());
    if (value.kind !== "map" && value.proofs?.length !== value.spots.length)
      throw new ApiError("INVALID_REQUEST");
    if (
      value.kind === "prize" &&
      value.spots.some((s, i) => s.capacity !== 1 || !value.proofs?.[i].email)
    )
      throw new ApiError("INVALID_REQUEST");
    if (
      value.kind === "puzzle" &&
      value.proofs?.some((p) => !p.answer || !p.clue.trim())
    )
      throw new ApiError("INVALID_REQUEST");
    const wallet = await ensureWallet(c.env, c.get("user").id);
    const id = crypto.randomUUID(),
      now = Date.now();
    const budget = value.spots.reduce(
      (sum, s) => sum + s.amount * s.capacity,
      0,
    );
    const statements = [];
    for (const [i, s] of value.spots.entries()) {
      const spotId = crypto.randomUUID(),
        p = value.proofs?.[i];
      const answer =
        value.kind === "puzzle"
          ? p?.answer
          : ["code", "qr"].includes(value.kind)
            ? crypto.randomUUID().replaceAll("-", "")
            : undefined;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO spot (id,event_id,title,latitude,longitude,radius,amount,capacity,remaining) VALUES (?,?,?,?,?,?,?,?,?)",
        ).bind(
          spotId,
          id,
          s.title,
          s.latitude,
          s.longitude,
          s.radius,
          s.amount,
          s.capacity,
          s.capacity,
        ),
      );
      if (value.kind !== "map")
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO drop_proof (spot_id,proof_hash,secret,clue,recipient_email) VALUES (?,?,?,?,?)",
          ).bind(
            spotId,
            answer ? await proofHash(c.env, answer) : null,
            answer ? await encryptProof(c.env, answer, spotId) : null,
            p?.clue ?? "",
            p?.email?.trim().toLowerCase() ?? null,
          ),
        );
    }
    const taken = new Set(
      (
        await c.env.DB.prepare("SELECT slug FROM event").all<{ slug: string }>()
      ).results.map((r) => r.slug),
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const slug = availableSlug(value.title, taken);
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug,creator_id,kind,single_claim,funding_wallet_id,funding_address) VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)",
          ).bind(
            id,
            value.title,
            value.venue,
            value.description,
            value.latitude,
            value.longitude,
            value.startsAt,
            value.endsAt,
            budget,
            now,
            slug,
            c.get("user").id,
            value.kind,
            value.kind === "prize" ? 0 : Number(value.singleClaim),
            wallet.id,
            wallet.address,
          ),
          ...statements,
        ]);
        return c.json({ id, slug }, 201);
      } catch (error) {
        if (
          !(
            String(error) + String((error as { cause?: unknown }).cause)
          ).includes("UNIQUE constraint failed: event.slug")
        )
          throw error;
        taken.add(slug);
      }
    }
    throw new ApiError("EVENT_SLUG_UNAVAILABLE", 409);
  });
  app.use("/v1/campaigns/:id/*", async (c, next) => {
    const event = await c.env.DB.prepare(
      "SELECT * FROM event WHERE id = ? AND creator_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<EventRow>();
    if (!event) throw new ApiError("EVENT_NOT_FOUND", 404);
    await next();
  });
  app.get("/v1/campaigns/:id/secrets", async (c) => {
    const rows = (
      await c.env.DB.prepare(
        "SELECT spot.id,spot.title,drop_proof.* FROM spot JOIN drop_proof ON drop_proof.spot_id = spot.id WHERE event_id = ?",
      )
        .bind(c.req.param("id"))
        .all<{
          spot_id: string;
          title: string;
          secret: string | null;
          clue: string;
          recipient_email: string | null;
        }>()
    ).results;
    return c.json({
      drops: await Promise.all(
        rows.map(async (r) => ({
          id: r.spot_id,
          title: r.title,
          answer: r.secret
            ? await decryptProof(c.env, r.secret, r.spot_id)
            : null,
          clue: r.clue,
          email: r.recipient_email,
        })),
      ),
    });
  });
  app.post("/v1/campaigns/:id/quote", async (c) => {
    const event = (await c.env.DB.prepare("SELECT * FROM event WHERE id = ?")
      .bind(c.req.param("id"))
      .first<EventRow>())!;
    if (event.status !== "draft")
      throw new ApiError("INVALID_EVENT_ACTION", 409);
    const quote = await fundingQuote(c.env, event),
      id = crypto.randomUUID();
    await c.env.DB.prepare(
      "UPDATE event SET funding_fee = ?,funding_quote_id = ?,funding_quote_at = ? WHERE id = ? AND status = 'draft'",
    )
      .bind(JSON.stringify(quote.parameters), id, Date.now(), event.id)
      .run();
    return c.json({ id, amount: quote.amount, fee: quote.fee });
  });
  app.post("/v1/campaigns/:id/actions", async (c) => {
    const { action, quoteId } = z
      .object({
        action: z.enum(["launch", "pause", "resume", "close", "refund"]),
        quoteId: z.string().uuid().optional(),
      })
      .parse(await c.req.json());
    if (action === "launch") {
      requireRecentAuth(c.get("sessionCreatedAt"));
      const event = (await c.env.DB.prepare("SELECT * FROM event WHERE id = ?")
        .bind(c.req.param("id"))
        .first<EventRow>())!;
      if (
        !quoteId ||
        quoteId !== event.funding_quote_id ||
        Date.now() - (event.funding_quote_at ?? 0) > 60_000 ||
        !event.funding_fee
      )
        throw new ApiError("QUOTE_EXPIRED", 409);
      await sufficientBalance(
        c.env,
        event.funding_address!,
        event.budget,
        maximumFee(JSON.parse(event.funding_fee)) * 2n,
      );
    }
    const operation = await startOperation(
      c.env,
      c.req.param("id"),
      action,
      quoteId,
    );
    c.executionCtx.waitUntil(
      reconcileOperation(c.env, operation).catch(() =>
        console.error(
          JSON.stringify({
            event: "operation_submission_pending",
            operationId: operation.id,
          }),
        ),
      ),
    );
    return c.json({ operation }, 202);
  });
  app.post("/v1/drops/resolve", async (c) => {
    if (!(await c.env.CLAIM_LIMIT.limit({ key: c.get("user").id })).success)
      throw new ApiError("RATE_LIMITED", 429);
    const { proof } = z
      .object({ proof: z.string().min(1).max(1000) })
      .parse(await c.req.json());
    const hash = await proofHash(c.env, proof);
    const drop = await c.env.DB.prepare(
      "SELECT spot.*,event.slug,event.title AS campaign_title,event.kind FROM spot JOIN event ON event.id = spot.event_id JOIN drop_proof ON drop_proof.spot_id = spot.id WHERE drop_proof.proof_hash = ? AND event.kind IN ('code','qr') AND event.status = 'active' AND event.starts_at <= ? AND event.ends_at > ? LIMIT 1",
    )
      .bind(hash, Date.now(), Date.now())
      .first();
    if (!drop) throw new ApiError("INVALID_PROOF", 404);
    return c.json({ drop });
  });
  app.post("/v1/campaigns/:id/retry", async (c) => {
    requireRecentAuth(c.get("sessionCreatedAt"));
    const op = await c.env.DB.prepare(
      "SELECT * FROM operation WHERE event_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(c.req.param("id"))
      .first<import("../db").OperationRow>();
    if (!op) throw new ApiError("OPERATION_NOT_RETRYABLE", 409);
    const event = (await c.env.DB.prepare("SELECT * FROM event WHERE id = ?")
      .bind(op.event_id)
      .first<EventRow>())!;
    if (op.action === "launch" && op.phase !== "activate") {
      if (!event.funding_fee) throw new ApiError("QUOTE_EXPIRED", 409);
      await sufficientBalance(
        c.env,
        event.funding_address!,
        op.phase === "activate" ? 0 : event.budget,
        maximumFee(JSON.parse(event.funding_fee)) *
          (op.phase === "fund" ? 1n : 2n),
      );
    }
    try {
      await c.env.DB.batch([
        ...(op.action === "launch"
          ? [
              c.env.DB.prepare(
                "INSERT INTO wallet_lock (user_id,operation_id) VALUES (?,?)",
              ).bind(c.get("user").id, op.id),
            ]
          : []),
        c.env.DB.prepare(
          "UPDATE operation SET status = 'pending',transaction_id = NULL,idempotency_key = ?,error = NULL,updated_at = ? WHERE id = ? AND status = 'failed'",
        ).bind(crypto.randomUUID(), Date.now(), op.id),
      ]);
    } catch {
      throw new ApiError("WALLET_BUSY", 409);
    }
    return c.json({ retried: true }, 202);
  });
  app.get("/v1/prizes", async (c) => {
    const prizes = (
      await c.env.DB.prepare(
        "SELECT spot.*,event.title AS campaign_title,event.slug,event.ends_at,event.status,claim.id AS claim_id,claim.status AS claim_status FROM spot JOIN event ON event.id = spot.event_id JOIN drop_proof ON drop_proof.spot_id = spot.id LEFT JOIN claim ON claim.spot_id = spot.id AND claim.user_id = ? AND claim.status != 'failed' WHERE drop_proof.recipient_email = ? AND event.kind = 'prize' AND event.status IN ('active','paused') AND event.ends_at > ? ORDER BY event.created_at DESC",
      )
        .bind(c.get("user").id, c.get("user").email.toLowerCase(), Date.now())
        .all()
    ).results;
    return c.json({ prizes });
  });
}
