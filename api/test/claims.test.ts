import { d1 } from "./d1";
import { proofHash, encryptProof } from "../src/proofs";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Bindings } from "../src/env";
vi.mock("../src/circle", () => ({
  ensureWallet: vi.fn(async () => ({
    id: "wallet",
    address: "0x2222222222222222222222222222222222222222",
  })),
  accountHash: vi.fn(async () => "0x" + "11".repeat(32)),
  contractTransaction: vi.fn(),
  circle: vi.fn(),
  escrowAddress: vi.fn(),
  payoutConfirmed: vi.fn(),
  rpc: vi.fn(),
}));
import { reserveClaim, failClaim, reconcileClaim } from "../src/claims";
import {
  ensureWallet,
  contractTransaction,
  circle,
  rpc,
  payoutConfirmed,
} from "../src/circle";
// Real SQLite constraints and atomic transactions mirror D1's batch behavior.
describe("claim reservations", () => {
  let sql: DatabaseSync, env: Bindings;
  const spotId = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    vi.clearAllMocks();
    sql = new DatabaseSync(":memory:");
    for (const name of [
      "0001_initial.sql",
      "0002_claim_validation.sql",
      "0003_event_slugs.sql",
      "0004_campaigns.sql",
      "0005_funding_quote_binding.sql",
    "0006_creator_gas.sql",
    ])
      sql.exec(
        readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
      );
    env = { DB: d1(sql), PROOF_SECRET: "test-proof-secret" } as Bindings;
    for (const id of ["a", "b", "c"])
      sql
        .prepare("INSERT INTO user VALUES (?,?,?,1,NULL,?,?)")
        .run(id, id, `${id}@example.com`, Date.now(), Date.now());
    sql
      .prepare(
        "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug) VALUES ('event','Event','Venue','',6.45,3.39,?,?,'active',1000000,?,'event')",
      )
      .run(Date.now() - 10000, Date.now() + 100000, Date.now());
    sql
      .prepare(
        "INSERT INTO spot VALUES (?,'event','Spot',6.45,3.39,50,1000000,1,1)",
      )
      .run(spotId);
  });
  const location = () => ({
    latitude: 6.45,
    longitude: 3.39,
    accuracy: 5,
    timestamp: Date.now(),
  });
  it("returns the existing reservation on repeated taps", async () => {
    const first = await reserveClaim(env, "a", spotId, location());
    const second = await reserveClaim(env, "a", spotId, location());
    expect(second.id).toBe(first.id);
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 0,
    });
  });
  it("rejects a second visitor after the last slot is reserved", async () => {
    await reserveClaim(env, "a", spotId, location());
    await expect(
      reserveClaim(env, "b", spotId, location()),
    ).rejects.toMatchObject({ code: "SPOT_EXHAUSTED" });
  });
  it("keeps reservations on ambiguous submission failures and reuses the key", async () => {
    const claim = await reserveClaim(env, "a", spotId, location());
    vi.mocked(contractTransaction).mockRejectedValue(
      new Error("Transport lost after submission"),
    );
    await expect(reconcileClaim(env, claim)).rejects.toThrow("Transport lost");
    await expect(reconcileClaim(env, claim)).rejects.toThrow("Transport lost");
    expect(
      vi.mocked(contractTransaction).mock.calls.map((call) => call[3]),
    ).toEqual([claim.idempotency_key, claim.idempotency_key]);
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 0,
    });
    expect(sql.prepare("SELECT status FROM claim").get()).toEqual({
      status: "reserved",
    });
  });
  it("never confirms a payout with a mismatched receipt", async () => {
    const claim = await reserveClaim(env, "a", spotId, location());
    vi.mocked(contractTransaction).mockResolvedValue("transaction");
    vi.mocked(circle).mockReturnValue({
      getTransaction: async () => ({
        data: {
          transaction: { state: "COMPLETE", txHash: "0x" + "ab".repeat(32) },
        },
      }),
    } as unknown as ReturnType<typeof circle>);
    vi.mocked(payoutConfirmed).mockResolvedValue(false);
    await expect(reconcileClaim(env, claim)).rejects.toThrow("does not match");
    expect(sql.prepare("SELECT status FROM claim").get()).toEqual({
      status: "submitted",
    });
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 0,
    });
  });
  it("releases a definitive failed transaction only after checking onchain state", async () => {
    const claim = await reserveClaim(env, "a", spotId, location());
    vi.mocked(contractTransaction).mockResolvedValue("transaction");
    vi.mocked(circle).mockReturnValue({
      getTransaction: async () => ({
        data: { transaction: { state: "FAILED" } },
      }),
    } as unknown as ReturnType<typeof circle>);
    vi.mocked(rpc).mockReturnValue({
      readContract: async () => false,
    } as unknown as ReturnType<typeof rpc>);
    await reconcileClaim(env, claim);
    expect(sql.prepare("SELECT status FROM claim").get()).toEqual({
      status: "failed",
    });
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 1,
    });
  });
  it("retains a failed Circle transaction reservation if the account was paid onchain", async () => {
    const claim = await reserveClaim(env, "a", spotId, location());
    vi.mocked(contractTransaction).mockResolvedValue("transaction");
    vi.mocked(circle).mockReturnValue({
      getTransaction: async () => ({
        data: { transaction: { state: "FAILED" } },
      }),
    } as unknown as ReturnType<typeof circle>);
    vi.mocked(rpc).mockReturnValue({
      readContract: async () => true,
    } as unknown as ReturnType<typeof rpc>);
    await reconcileClaim(env, claim);
    expect(sql.prepare("SELECT status FROM claim").get()).toEqual({
      status: "submitted",
    });
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 0,
    });
  });
  it("rolls back capacity when one account races two spots", async () => {
    sql
      .prepare(
        "INSERT INTO spot VALUES (?,'event','Other',6.45,3.39,50,1000000,1,1)",
      )
      .run("22222222-2222-4222-8222-222222222222");
    const first = await reserveClaim(env, "a", spotId, location());
    const repeated = await reserveClaim(
      env,
      "a",
      "22222222-2222-4222-8222-222222222222",
      location(),
    );
    expect(repeated.id).toBe(first.id);
    expect(
      sql.prepare("SELECT remaining FROM spot WHERE title = 'Other'").get(),
    ).toEqual({ remaining: 1 });
  });
  it("releases a failed reservation only once and permits a new attempt", async () => {
    const claim = await reserveClaim(env, "a", spotId, location());
    await failClaim(env.DB, claim.id, "PAYOUT_FAILED");
    await failClaim(env.DB, claim.id, "PAYOUT_FAILED");
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 1,
    });
    const retry = await reserveClaim(env, "a", spotId, location());
    expect(retry.id).not.toBe(claim.id);
  });
  it("does not reserve for stale location or paused events", async () => {
    await expect(
      reserveClaim(env, "a", spotId, {
        ...location(),
        timestamp: Date.now() - 20000,
      }),
    ).rejects.toMatchObject({ code: "STALE_LOCATION" });
    sql.exec("UPDATE event SET status='paused'");
    await expect(
      reserveClaim(env, "a", spotId, location()),
    ).rejects.toMatchObject({ code: "EVENT_UNAVAILABLE" });
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 1,
    });
  });
  it("rechecks event eligibility atomically after wallet provisioning", async () => {
    vi.mocked(ensureWallet).mockImplementationOnce(async () => {
      sql.exec("UPDATE event SET status='paused'");
      return {
        id: "wallet",
        address: "0x2222222222222222222222222222222222222222",
      };
    });
    await expect(
      reserveClaim(env, "a", spotId, location()),
    ).rejects.toMatchObject({ code: "SPOT_UNAVAILABLE" });
    expect(sql.prepare("SELECT remaining FROM spot").get()).toEqual({
      remaining: 1,
    });
  });

  it("allows distinct drops when the campaign permits it, but prevents repeat drops", async () => {
    sql.exec("UPDATE event SET single_claim = 0");
    sql
      .prepare(
        "INSERT INTO spot VALUES (?,'event','Other',6.45,3.39,50,1000000,1,1)",
      )
      .run("22222222-2222-4222-8222-222222222222");
    const first = await reserveClaim(env, "a", spotId, location());
    const second = await reserveClaim(
      env,
      "a",
      "22222222-2222-4222-8222-222222222222",
      location(),
    );
    expect(first.id).not.toBe(second.id);
    expect((await reserveClaim(env, "a", spotId, location())).id).toBe(
      first.id,
    );
  });
  it("checks prize eligibility against the verified account email", async () => {
    sql.exec("UPDATE event SET kind = 'prize',single_claim = 0");
    sql
      .prepare("INSERT INTO drop_proof (spot_id,recipient_email) VALUES (?,?)")
      .run(spotId, "a@example.com");
    await expect(reserveClaim(env, "b", spotId)).rejects.toMatchObject({
      code: "PRIZE_NOT_ASSIGNED",
    });
    expect((await reserveClaim(env, "a", spotId)).status).toBe("reserved");
  });
  it("validates normalized puzzle answers without requiring GPS", async () => {
    sql.exec("UPDATE event SET kind = 'puzzle'");
    sql
      .prepare(
        "INSERT INTO drop_proof (spot_id,proof_hash,secret,clue) VALUES (?,?,?,?)",
      )
      .run(
        spotId,
        await proofHash(env, "Blue Moon"),
        await encryptProof(env, "Blue Moon", spotId),
        "A clue",
      );
    await expect(
      reserveClaim(env, "b", spotId, undefined, "wrong"),
    ).rejects.toMatchObject({ code: "INVALID_PROOF" });
    expect(
      (await reserveClaim(env, "a", spotId, undefined, "  BLUE   moon "))
        .status,
    ).toBe("reserved");
  });
  it("enforces the campaign policy in the database even for a competing direct insertion", async () => {
    await reserveClaim(env, "a", spotId, location());
    sql
      .prepare(
        "INSERT INTO spot VALUES (?,'event','Other',6.45,3.39,50,1000000,1,1)",
      )
      .run("22222222-2222-4222-8222-222222222222");
    expect(() =>
      sql
        .prepare(
          "INSERT INTO claim SELECT 'other',user_id,event_id,'22222222-2222-4222-8222-222222222222',account_hash,recipient,amount,'other-key',NULL,NULL,'reserved',NULL,created_at,updated_at FROM claim LIMIT 1",
        )
        .run(),
    ).toThrow("CAMPAIGN_ALREADY_CLAIMED");
  });
});
