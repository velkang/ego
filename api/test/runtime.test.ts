import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import type { Bindings } from "../src/env";
const balanceRpc = vi.hoisted(() => vi.fn(async () => 100n * 10n ** 18n));
vi.mock("../src/circle", () => ({
  ensureWallet: async () => ({
    id: "wallet",
    address: "0x2222222222222222222222222222222222222222",
  }),
  accountHash: async () => `0x${"11".repeat(32)}`,
  circle: () => ({
    getTransaction: async () => ({
      data: { transaction: { state: "PENDING" } },
    }),
  }),
  contractTransaction: async () => crypto.randomUUID(),
  verifyCircleWebhook: async () => false,
  rpc: () => ({ getBalance: balanceRpc }),
}));
import webWorker from "../../web/worker";
import { proofHash } from "../src/proofs";
import { createApp } from "../src/index";
let mf: Miniflare,
  env: Bindings,
  otp = "",
  cookies = "";
const app = createApp(),
  pending: Promise<unknown>[] = [];
const origin = "https://jovva.example";
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };
async function request(
  path: string,
  body?: unknown,
  cookie = cookies,
): Promise<TestResponse> {
  const context = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p.catch(() => {}));
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const raw = new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await webWorker.fetch(raw, {
    API: { fetch: async (request) => app.fetch(request, env, context) },
  })) as TestResponse;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "api",
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: "2026-10-12",
          d1Databases: { DB: "runtime-test" },
        },
      ],
    }),
  );
  const db = await mf.getD1Database("DB", "api");
  for (const name of [
    "0001_initial.sql",
    "0002_claim_validation.sql",
    "0003_event_slugs.sql",
    "0004_campaigns.sql",
    "0005_funding_quote_binding.sql",
  ]) {
    const sql = readFileSync(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    // Use the migration runner's parser rather than a separate trigger regex.
    for (const statement of splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  env = {
    DB: db,
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: "runtime-auth-secret-at-least-32-characters",
    RESEND_API_KEY: "test-resend",
    EMAIL_FROM: "Ego <login@example.com>",
    AUTH_LIMIT: { limit: async () => ({ success: true }) },
    CLAIM_LIMIT: { limit: async () => ({ success: true }) },
    PROOF_SECRET: "proof-secret",
    OPERATOR_EMAILS: "",
  } as unknown as Bindings;
  const original = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === "https://api.resend.com/emails") {
      const body = JSON.parse(String(init?.body));
      otp = /code is (\d{6})/.exec(body.text)?.[1] ?? "";
      return Response.json({ id: "email" });
    }
    return original(input, init);
  });
}, 30000);
afterAll(async () => {
  await Promise.all(pending);
  vi.restoreAllMocks();
  await mf?.dispose();
});
it("uses actual Better Auth OTP and D1 sessions, rejects replay, and restricts operators", async () => {
  expect(
    (
      await request(
        "/v1/auth/email-otp/send-verification-otp",
        { email: "winner@example.com", type: "sign-in" },
        "",
      )
    ).status,
  ).toBe(200);
  expect(otp).toMatch(/^\d{6}$/);
  const signIn = await request(
    "/v1/auth/sign-in/email-otp",
    { email: "winner@example.com", otp },
    "",
  );
  expect(signIn.status).toBe(200);
  cookies = signIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  expect(cookies).toContain("session_token");
  expect(
    (
      await request(
        "/v1/auth/sign-in/email-otp",
        { email: "winner@example.com", otp },
        "",
      )
    ).status,
  ).not.toBe(200);
  expect((await request("/v1/me")).status).toBe(200);
  expect((await request("/v1/admin/events")).status).toBe(403);
  expect((await request("/v1/wallet", {})).status).toBe(200);
});
it("reserves the final reward atomically in real D1 and confirms no payout prematurely", async () => {
  const me = await (await request("/v1/me")).json();
  const id = crypto.randomUUID(),
    spot = crypto.randomUUID(),
    now = Date.now();
  await env.DB.prepare(
    "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug,kind,single_claim) VALUES (?,'Prize','Venue','',0,0,?,?,'active',5000000,?,'runtime-prize','prize',0)",
  )
    .bind(id, now - 1000, now + 60000, now)
    .run();
  await env.DB.prepare("INSERT INTO spot VALUES (?,?,?,0,0,50,5000000,1,1)")
    .bind(spot, id, "Winner")
    .run();
  await env.DB.prepare(
    "INSERT INTO drop_proof (spot_id,recipient_email) VALUES (?,?)",
  )
    .bind(spot, me.user.email)
    .run();
  const responses = await Promise.all([
    request("/v1/claims", { spotId: spot }),
    request("/v1/claims", { spotId: spot }),
  ]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  expect(bodies[0].claim.id).toBe(bodies[1].claim.id);
  expect(bodies[0].claim.status).not.toBe("confirmed");
  expect(
    (
      await env.DB.prepare("SELECT remaining FROM spot WHERE id = ?")
        .bind(spot)
        .first<{ remaining: number }>()
    )?.remaining,
  ).toBe(0);
});

it("lets only one of two verified accounts reserve a final shared-code slot", async () => {
  const first = cookies;
  await request(
    "/v1/auth/email-otp/send-verification-otp",
    { email: "second@example.com", type: "sign-in" },
    "",
  );
  const signed = await request(
    "/v1/auth/sign-in/email-otp",
    { email: "second@example.com", otp },
    "",
  );
  const second = signed.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const id = crypto.randomUUID(),
    spot = crypto.randomUUID(),
    now = Date.now();
  await env.DB.prepare(
    "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug,kind) VALUES (?,'Code','Venue','',0,0,?,?,'active',1000000,?,'runtime-code','code')",
  )
    .bind(id, now - 1000, now + 60000, now)
    .run();
  await env.DB.prepare("INSERT INTO spot VALUES (?,?,?,0,0,50,1000000,1,1)")
    .bind(spot, id, "Code")
    .run();
  await env.DB.prepare(
    "INSERT INTO drop_proof (spot_id,proof_hash) VALUES (?,?)",
  )
    .bind(spot, await proofHash(env, "shared-secret"))
    .run();
  const responses = await Promise.all([
    request("/v1/claims", { spotId: spot, proof: "shared-secret" }, first),
    request("/v1/claims", { spotId: spot, proof: "shared-secret" }, second),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM claim WHERE spot_id = ?",
      )
        .bind(spot)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("keeps a provisioned wallet and history available when balance RPC is limited, and recovers on retry", async () => {
  const me = await (await request("/v1/me")).json();
  const address = "0x2222222222222222222222222222222222222222";
  await env.DB.prepare(
    "INSERT INTO wallet (user_id,idempotency_key,wallet_id,address,created_at) VALUES (?,?,?,?,?)",
  ).bind(me.user.id, crypto.randomUUID(), "wallet", address, Date.now()).run();
  const before = await request("/v1/wallet");
  const history = (await before.json()).claims;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  balanceRpc.mockRejectedValueOnce(Object.assign(new Error("RPC limited"), { code: -32005 }));
  const limited = await request("/v1/wallet");
  expect(limited.status).toBe(200);
  expect(await limited.json()).toEqual({
    wallet: { address }, balance: null, balanceUnits: null,
    balanceError: "BALANCE_UNAVAILABLE", claims: history,
  });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"code":-32005'));
  const recovered = await request("/v1/wallet");
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({
    wallet: { address }, balance: "100", balanceUnits: "100000000", balanceError: null,
  });
  balanceRpc.mockResolvedValueOnce(0n);
  const empty = await (await request("/v1/wallet")).json();
  expect(empty).toMatchObject({ balance: "0", balanceUnits: "0", balanceError: null });
  expect(balanceRpc.mock.calls.length).toBeGreaterThan(0);
  warn.mockRestore();
});
