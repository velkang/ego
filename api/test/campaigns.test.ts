import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { d1 } from "./d1";
import type { Bindings } from "../src/env";
const state = vi.hoisted(() => ({
  user: { id: "a", email: "a@example.com", emailVerified: true },
  createdAt: Date.now(),
}));
vi.mock("../src/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => ({
        user: state.user,
        session: { createdAt: new Date(state.createdAt) },
      }),
    },
  }),
  isOperator: () => false,
}));
vi.mock("../src/circle", () => ({
  ensureWallet: vi.fn(async () => ({
    id: "wallet",
    address: "0x2222222222222222222222222222222222222222",
  })),
  circle: vi.fn(),
  rpc: () => ({
    getBalance: async () => 1000n * 10n ** 18n,
    estimateGas: async () => 190000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
    }),
  }),
  escrowAddress: () => "0x3333333333333333333333333333333333333333",
  contractTransaction: vi.fn(async () => "tx"),
  verifyCircleWebhook: vi.fn(),
  accountHash: vi.fn(),
  payoutConfirmed: vi.fn(),
}));
import { createApp } from "../src/index";
import { circle } from "../src/circle";
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };
let sql: DatabaseSync, env: Bindings;
const app = createApp();
const pending: Promise<unknown>[] = [];
async function request(path: string, body?: unknown) {
  return (await app.request(
    `https://ego.example/v1${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "https://ego.example",
        Cookie: "session=fake",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    {
      waitUntil: (p: Promise<unknown>) => pending.push(p.catch(() => {})),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  )) as TestResponse;
}
const campaign = (kind = "code") => ({
  title: "Shared title",
  venue: "Venue",
  description: "",
  latitude: 6.45,
  longitude: 3.39,
  startsAt: Date.now(),
  endsAt: Date.now() + 86400000,
  spots: [
    {
      title: "Reward",
      latitude: 6.45,
      longitude: 3.39,
      radius: 50,
      amount: 5000000,
      capacity: 1,
    },
  ],
  kind,
  singleClaim: true,
  proofs: [
    {
      clue: "A clue",
      answer: kind === "puzzle" ? "Moon" : undefined,
      email: kind === "prize" ? "a@example.com" : undefined,
    },
  ],
});
beforeEach(() => {
  state.user = { id: "a", email: "a@example.com", emailVerified: true };
  state.createdAt = Date.now();
  sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_claim_validation.sql",
    "0003_event_slugs.sql",
    "0004_campaigns.sql",
    "0005_funding_quote_binding.sql",
    "0006_creator_gas.sql",
    "0007_finance.sql",
  ])
    sql.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  for (const id of ["a", "b"])
    sql
      .prepare("INSERT INTO user VALUES (?,?,?,1,NULL,?,?)")
      .run(id, id, `${id}@example.com`, Date.now(), Date.now());
  env = {
    DB: d1(sql),
    APP_ORIGIN: "https://ego.example",
    BETTER_AUTH_SECRET: "test",
    PROOF_SECRET: "private-test-secret",
    AUTH_LIMIT: { limit: async () => ({ success: true }) },
    CLAIM_LIMIT: { limit: async () => ({ success: true }) },
  } as unknown as Bindings;
  pending.length = 0;
});
afterEach(async () => {
  await Promise.all(pending);
  sql.close();
});
it("creates encrypted codes, gives stable duplicate slugs, and enforces creator ownership", async () => {
  const first = await (await request("/campaigns", campaign())).json();
  const second = await (await request("/campaigns", campaign())).json();
  expect(first.slug).toBe("shared-title");
  expect(second.slug).toBe("shared-title-2");
  const owned = await (await request(`/campaigns/${first.id}/secrets`)).json();
  expect(owned.drops[0].answer).toMatch(/^[a-f0-9]{32}$/);
  const stored = sql
    .prepare("SELECT secret,proof_hash FROM drop_proof LIMIT 1")
    .get()!;
  expect(stored.secret).not.toContain(owned.drops[0].answer);
  sql.exec("UPDATE event SET status='active'");
  const detail = await (await request(`/events/${first.slug}`)).json();
  expect(JSON.stringify(detail)).not.toContain(owned.drops[0].answer);
  expect(detail.event.funding_address).toBeUndefined();
  state.user = { id: "b", email: "b@example.com", emailVerified: true };
  expect((await request(`/campaigns/${first.id}/secrets`)).status).toBe(404);
  expect(
    (await request(`/campaigns/${first.id}/actions`, { action: "close" }))
      .status,
  ).toBe(404);
});
it("binds funding confirmation to the reviewed quote and requires recent verification", async () => {
  const created = await (await request("/campaigns", campaign())).json();
  const quote = await (
    await request(`/campaigns/${created.id}/quote`, {})
  ).json();
  expect(quote.amount).toBe(5000000);
  const saved = JSON.parse(
    sql.prepare("SELECT funding_fee FROM event WHERE id=?").get(created.id)!
      .funding_fee as string,
  );
  expect(Object.keys(saved.fees)).toEqual([
    "create",
    "approve",
    "fund",
    "activate",
  ]);
  expect(saved.action).toBe("launch");
  expect(Number(quote.fee)).toBeGreaterThan(0);
  expect(
    (
      await request(`/campaigns/${created.id}/actions`, {
        action: "launch",
        quoteId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(409);
  state.createdAt = Date.now() - 600000;
  expect(
    (
      await request(`/campaigns/${created.id}/actions`, {
        action: "launch",
        quoteId: quote.id,
      })
    ).status,
  ).toBe(401);
  state.createdAt = Date.now();
  expect(
    (
      await request(`/campaigns/${created.id}/actions`, {
        action: "launch",
        quoteId: quote.id,
      })
    ).status,
  ).toBe(202);
  expect(
    sql
      .prepare("SELECT operation_id FROM wallet_lock WHERE user_id = ?")
      .get("a"),
  ).toBeTruthy();
});
it("prizes use the authenticated email, with no invitation delivery", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const created = await (await request("/campaigns", campaign("prize"))).json();
  sql.exec("UPDATE event SET status='active'");
  expect(
    sql.prepare("SELECT single_claim FROM event WHERE id = ?").get(created.id)
      ?.single_claim,
  ).toBe(0);
  expect((await (await request("/prizes")).json()).prizes).toHaveLength(1);
  state.user = { id: "b", email: "b@example.com", emailVerified: true };
  expect(
    (await (await request("/prizes?email=a@example.com")).json()).prizes,
  ).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
it("resolves funded codes and limits guesses", async () => {
  const created = await (await request("/campaigns", campaign())).json();
  const secret = (
    await (await request(`/campaigns/${created.id}/secrets`)).json()
  ).drops[0].answer;
  expect((await request("/drops/resolve", { proof: secret })).status).toBe(404);
  sql.exec("UPDATE event SET status='active'");
  expect((await request("/drops/resolve", { proof: secret })).status).toBe(200);
  expect((await request("/drops/resolve", { proof: "wrong" })).status).toBe(
    404,
  );
  env.CLAIM_LIMIT = { limit: async () => ({ success: false }) };
  expect((await request("/drops/resolve", { proof: secret })).status).toBe(429);
});
it("serializes sends with funding and returns the same send after repeated confirmation", async () => {
  vi.mocked(circle).mockReturnValue({
    estimateContractExecutionFee: async () => ({
      data: { medium: { maxFee: "1", priorityFee: "0.1", gasLimit: "60000" } },
    }),
    getTransaction: async () => ({
      data: { transaction: { state: "PENDING" } },
    }),
  } as unknown as ReturnType<typeof circle>);
  const quote = await (
    await request("/wallet/send/quote", {
      recipient: "0x4444444444444444444444444444444444444444",
      amount: 5000000,
    })
  ).json();
  const sent = await (
    await request(`/wallet/send/${quote.quote.id}`, {})
  ).json();
  expect(sent.transaction.status).toBe("pending");
  expect(
    (await (await request(`/wallet/send/${quote.quote.id}`, {})).json())
      .transaction.id,
  ).toBe(sent.transaction.id);
  const other = await (
    await request("/wallet/send/quote", {
      recipient: "0x5555555555555555555555555555555555555555",
      amount: 5000000,
    })
  ).json();
  expect((await request(`/wallet/send/${other.quote.id}`, {})).status).toBe(
    409,
  );
  const campaignId = await (await request("/campaigns", campaign())).json();
  const funding = await (
    await request(`/campaigns/${campaignId.id}/quote`, {})
  ).json();
  expect(
    (
      await request(`/campaigns/${campaignId.id}/actions`, {
        action: "launch",
        quoteId: funding.id,
      })
    ).status,
  ).toBe(409);
});

it("discovery excludes earned campaigns and marks collected spots in multi-drop campaigns", async () => {
  const created = await (await request("/campaigns", campaign("map"))).json();
  sql.exec("UPDATE event SET status='active'");
  const spot = sql.prepare("SELECT id FROM spot LIMIT 1").get()?.id as string;
  sql
    .prepare(
      "INSERT INTO claim (id,user_id,event_id,spot_id,account_hash,recipient,amount,idempotency_key,status,created_at,updated_at) VALUES ('earned','a',?,?,?, ?,5000000,'earned-key','confirmed',?,?)",
    )
    .run(
      created.id,
      spot,
      "0x" + "11".repeat(32),
      "0x2222222222222222222222222222222222222222",
      Date.now(),
      Date.now(),
    );
  expect((await (await request("/drops")).json()).drops).toHaveLength(0);
  sql.prepare("UPDATE event SET single_claim=0 WHERE id=?").run(created.id);
  sql
    .prepare("INSERT INTO spot VALUES (?,?,'Other',6.45,3.39,50,1000000,1,1)")
    .run(crypto.randomUUID(), created.id);
  expect((await (await request("/drops")).json()).drops).toHaveLength(1);
  const detail = await (await request(`/events/${created.slug}`)).json();
  expect(detail.spots.find((s: { id: string }) => s.id === spot).claimed).toBe(
    true,
  );
});

it("reviews creator management fees and requires fresh OTP for confirmation", async () => {
  const created = await (await request("/campaigns", campaign())).json();
  sql.prepare("UPDATE event SET status='active' WHERE id=?").run(created.id);
  const q = await (
    await request(`/campaigns/${created.id}/quote`, { action: "pause" })
  ).json();
  expect(q.action).toBe("pause");
  expect(q.amount).toBe(0);
  state.createdAt = Date.now() - 600000;
  expect(
    (
      await request(`/campaigns/${created.id}/actions`, {
        action: "pause",
        quoteId: q.id,
      })
    ).status,
  ).toBe(401);
  state.createdAt = Date.now();
  expect(
    (
      await request(`/campaigns/${created.id}/actions`, {
        action: "pause",
        quoteId: q.id,
      })
    ).status,
  ).toBe(202);
  expect(
    sql.prepare("SELECT * FROM wallet_lock WHERE user_id='a'").get(),
  ).toBeTruthy();
});
