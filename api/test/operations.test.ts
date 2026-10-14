import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { encodeEventTopics, encodeAbiParameters, parseAbi } from "viem";
import { chainIdentifier, USDC_ADDRESS } from "@jovva/chain";
import { d1 } from "./d1";
import type { Bindings } from "../src/env";
import type { OperationRow } from "../src/db";
vi.mock("../src/circle", () => ({
  circle: vi.fn(),
  contractTransaction: vi.fn(),
  escrowAddress: () => "0x3333333333333333333333333333333333333333",
  rpc: vi.fn(),
}));
import { circle, contractTransaction, rpc } from "../src/circle";
import { startOperation, reconcileOperation } from "../src/operations";
let sql: DatabaseSync, env: Bindings;
const creator = "0x2222222222222222222222222222222222222222",
  escrow = "0x3333333333333333333333333333333333333333",
  hash = `0x${"aa".repeat(32)}`;
beforeEach(() => {
  vi.clearAllMocks();
  sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_claim_validation.sql",
    "0003_event_slugs.sql",
    "0004_campaigns.sql",
    "0005_funding_quote_binding.sql",
  ])
    sql.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  sql
    .prepare("INSERT INTO user VALUES (?,?,?,1,NULL,?,?)")
    .run("a", "A", "a@example.com", Date.now(), Date.now());
  sql
    .prepare(
      "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug,creator_id,funding_wallet_id,funding_address,funding_fee) VALUES ('event','Event','Venue','',0,0,?,?,'draft',5000000,?,'event','a','creator-wallet',?,?)",
    )
    .run(
      Date.now(),
      Date.now() + 86400000,
      Date.now(),
      creator,
      JSON.stringify({
        type: "absolute",
        config: { maxFee: "1", priorityFee: "0.1", gasLimit: "200000" },
      }),
    );
  sql
    .prepare("UPDATE event SET funding_quote_id='quote',funding_quote_at=?")
    .run(Date.now());
  sql.exec(
    "INSERT INTO spot VALUES ('spot','event','Spot',0,0,50,5000000,1,1)",
  );
  env = { DB: d1(sql) } as Bindings;
  vi.mocked(contractTransaction).mockResolvedValue("transaction");
  vi.mocked(circle).mockReturnValue({
    getTransaction: async () => ({
      data: { transaction: { state: "COMPLETE", txHash: hash } },
    }),
  } as unknown as ReturnType<typeof circle>);
});
afterEach(() => sql.close());
const op = () =>
  sql.prepare("SELECT * FROM operation").get() as unknown as OperationRow;
type Phase = "create" | "approve" | "fund" | "activate";
function receipt(phase: Phase) {
  const id = chainIdentifier("event");
  const signatures: Record<string, string> = {
    create: "event EventCreated(bytes32 indexed id,uint256 required)",
    approve:
      "event Approval(address indexed owner,address indexed spender,uint256 value)",
    fund: "event Funded(bytes32 indexed id,uint256 amount)",
    activate: "event Activated(bytes32 indexed id)",
  };
  const name = (
    {
      create: "EventCreated",
      approve: "Approval",
      fund: "Funded",
      activate: "Activated",
    } as const
  )[phase];
  return {
    status: "success",
    logs: [
      {
        address: phase === "approve" ? USDC_ADDRESS : escrow,
        topics: encodeEventTopics({
          abi: parseAbi([
            "event EventCreated(bytes32 indexed id,uint256 required)",
            "event Approval(address indexed owner,address indexed spender,uint256 value)",
            "event Funded(bytes32 indexed id,uint256 amount)",
            "event Activated(bytes32 indexed id)",
          ]),
          eventName: name,
          args:
            phase === "approve" ? { owner: creator, spender: escrow } : { id },
        }),
        data:
          phase === "activate"
            ? "0x"
            : encodeAbiParameters([{ type: "uint256" }], [5000000n]),
      },
    ],
  };
}
it("uses creator fees only for approve/fund and publishes only after activation receipt", async () => {
  vi.mocked(rpc).mockReturnValue({
    getBalance: async () => 100n * 10n ** 18n,
    getTransactionReceipt: async () => receipt(op().phase as Phase),
  } as unknown as ReturnType<typeof rpc>);
  await startOperation(env, "event", "launch", "quote");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeTruthy();
  for (const phase of ["create", "approve", "fund", "activate"]) {
    expect(op().phase).toBe(phase);
    expect(sql.prepare("SELECT status FROM event").get()?.status).toBe(
      "launching",
    );
    await reconcileOperation(env, op());
  }
  expect(sql.prepare("SELECT status FROM event").get()?.status).toBe("active");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
  const calls = vi.mocked(contractTransaction).mock.calls;
  expect(calls.map((c) => c[5])).toEqual([
    undefined,
    "creator-wallet",
    "creator-wallet",
    undefined,
  ]);
  expect(calls[0][2].at(-2)).toBe(creator);
  expect(calls[0][2].at(-1)).toBe(true);
  expect(calls[1][6]).toMatchObject({ type: "absolute" });
  expect(calls[2][2][1]).toBe("5000000");
});
it("retains the lock and stable idempotency key after uncertain submission", async () => {
  await startOperation(env, "event", "launch", "quote");
  vi.mocked(contractTransaction).mockRejectedValue(new Error("response lost"));
  const original = op();
  await expect(reconcileOperation(env, original)).rejects.toThrow(
    "response lost",
  );
  await expect(reconcileOperation(env, op())).rejects.toThrow("response lost");
  expect(vi.mocked(contractTransaction).mock.calls.map((c) => c[3])).toEqual([
    original.idempotency_key,
    original.idempotency_key,
  ]);
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeTruthy();
});
it("does not advance on a successful but unrelated receipt", async () => {
  await startOperation(env, "event", "launch", "quote");
  vi.mocked(rpc).mockReturnValue({
    getTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as ReturnType<typeof rpc>);
  await expect(reconcileOperation(env, op())).rejects.toThrow(
    "receipt does not match",
  );
  expect(op().phase).toBe("create");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeTruthy();
});
it("releases the creator lock only for a definitive failure", async () => {
  await startOperation(env, "event", "launch", "quote");
  vi.mocked(circle).mockReturnValue({
    getTransaction: async () => ({
      data: { transaction: { state: "FAILED" } },
    }),
  } as unknown as ReturnType<typeof circle>);
  await reconcileOperation(env, op());
  expect(op().status).toBe("failed");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
});

it("atomically rejects a replaced funding quote without taking a wallet lock", async () => {
  sql.exec("UPDATE event SET funding_quote_id='new-quote'");
  await expect(
    startOperation(env, "event", "launch", "quote"),
  ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
  expect(sql.prepare("SELECT * FROM operation").get()).toBeUndefined();
});
