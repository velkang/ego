import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  encodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbi,
  type Hex,
} from "viem";
import {
  assetAmount,
  assetDefinition,
  type FinanceQuote,
  type FinanceOperation,
} from "@ego/chain";
import { d1 } from "./d1";
import type { Bindings } from "../src/env";
const state = vi.hoisted(() => ({
  user: "a",
  createdAt: Date.now(),
  native: 100n * 10n ** 18n,
  token: 1000000000n,
  complete: false,
  wrongInput: false,
  uncertain: false,
  providerError: false,
  rejected: false,
  reverted: false,
  gas: 80000n,
  gasPause: undefined as Promise<void> | undefined,
  forwarded: false,
  recovered: false,
  transactions: new Map<
    string,
    {
      id: string;
      callData: string;
      contractAddress: string;
      key: string;
      hash: Hex;
    }
  >(),
  keys: [] as string[],
  prepared: 0,
}));
const owner = "0x2222222222222222222222222222222222222222",
  recipient = "0x3333333333333333333333333333333333333333";
const transferAbi = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
vi.mock("../src/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => ({
        user: {
          id: state.user,
          email: `${state.user}@example.com`,
          emailVerified: true,
        },
        session: { createdAt: new Date(state.createdAt) },
      }),
    },
  }),
  isOperator: () => false,
}));
vi.mock("../src/circle", () => ({
  ensureWallet: async () => ({
    id: "wallet",
    address: "0x2222222222222222222222222222222222222222",
  }),
  rpc: () => ({
    getBalance: async () => state.native,
    readContract: async () => state.token,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
    }),
    estimateGas: async () => {
      await state.gasPause;
      return state.gas;
    },
    getTransaction: async ({ hash }: { hash: string }) => {
      const tx = [...state.transactions.values()].find((t) => t.hash === hash)!;
      return {
        from: "0x2222222222222222222222222222222222222222",
        to: tx.contractAddress,
        input: state.wrongInput ? "0x00" : tx.callData,
        value: 0n,
      };
    },
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const tx = [...state.transactions.values()].find((t) => t.hash === hash)!;
      const to = `0x${tx.callData.slice(34, 74)}` as Hex;
      const amount = BigInt(`0x${tx.callData.slice(-64)}`);
      return {
        status: state.reverted ? "reverted" : "success",
        to: tx.contractAddress,
        logs: [
          {
            address: tx.contractAddress,
            topics: encodeEventTopics({
              abi: transferAbi,
              eventName: "Transfer",
              args: { from: owner, to },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [amount]),
          },
        ],
      };
    },
  }),
  circle: () => ({
    getWallet: async () => ({
      data: {
        wallet: { address: "0x2222222222222222222222222222222222222222" },
      },
    }),
    createContractExecutionTransaction: async (input: {
      idempotencyKey: string;
      callData: string;
      contractAddress: string;
    }) => {
      state.keys.push(input.idempotencyKey);
      if (state.rejected) throw { response: { status: 400 } };
      let tx = state.transactions.get(input.idempotencyKey);
      if (!tx) {
        tx = {
          id: `tx-${state.transactions.size}`,
          callData: input.callData,
          contractAddress: input.contractAddress,
          key: input.idempotencyKey,
          hash: `0x${(state.transactions.size + 1).toString(16).padStart(64, "0")}`,
        };
        state.transactions.set(input.idempotencyKey, tx);
      }
      if (state.uncertain) {
        state.uncertain = false;
        throw new Error("lost response after submission");
      }
      return { data: { id: tx.id } };
    },
    getTransaction: async ({ id }: { id: string }) => ({
      data: {
        transaction: {
          state: state.complete ? "COMPLETE" : "PENDING",
          txHash: state.complete
            ? [...state.transactions.values()].find((t) => t.id === id)?.hash
            : undefined,
        },
      },
    }),
  }),
}));
vi.mock("../src/finance-provider", async (load) => {
  const actual = await load<typeof import("../src/finance-provider")>();
  return {
    ...actual,
    verifyAssets: async () => {},
    providerQuote: async (
      _env: unknown,
      _wallet: unknown,
      request: { asset: "USDC"; amount: string },
    ) => ({
      expected: assetAmount(request.amount, 6),
      minimum: assetAmount(request.amount, 6),
      output: request.asset,
      fees: [],
    }),
    executeProvider: async (
      _env: unknown,
      _wallet: unknown,
      request: {
        recipient: Hex;
        amount: string;
        asset: "USDC";
        destination?: string;
      },
      _minimum: string,
      _provider: unknown,
      _recovery: unknown,
      execute: (call: { to: Hex; data: Hex; value: string }) => Promise<string>,
    ) => {
      if (state.providerError) throw new Error("provider unavailable");
      state.prepared++;
      const hash = await execute({
        to: assetDefinition(request.asset).address,
        value: "0",
        data: encodeFunctionData({
          abi: transferAbi,
          functionName: "transfer",
          args: [request.recipient, BigInt(request.amount)],
        }),
      });
      if (request.destination && request.destination !== "Arc") {
        state.recovered = !!_recovery;
        return {
          complete: state.forwarded,
          hash: state.forwarded ? `0x${"ee".repeat(32)}` : undefined,
          recovery: JSON.stringify({ burned: true }),
        };
      }
      return { complete: true, hash };
    },
  };
});
import { createApp } from "../src/index";
import { reconcileFinance } from "../src/finance";
import {
  capabilities,
  financeJson,
  validRecipient,
} from "../src/finance-provider";
let sql: DatabaseSync, env: Bindings;
let pending: Promise<unknown>[];
const app = createApp();
beforeEach(() => {
  Object.assign(state, {
    user: "a",
    createdAt: Date.now(),
    native: 100n * 10n ** 18n,
    token: 1000000000n,
    complete: false,
    wrongInput: false,
    uncertain: false,
    providerError: false,
    rejected: false,
    reverted: false,
    gas: 80000n,
    gasPause: undefined,
    forwarded: false,
    recovered: false,
    prepared: 0,
  });
  state.transactions.clear();
  state.keys.length = 0;
  pending = [];
  sql = new DatabaseSync(":memory:");
  for (const migration of [
    "0001_initial",
    "0002_claim_validation",
    "0003_event_slugs",
    "0004_campaigns",
    "0005_funding_quote_binding",
    "0006_creator_gas",
    "0007_finance",
  ])
    sql.exec(
      readFileSync(
        new URL(`../migrations/${migration}.sql`, import.meta.url),
        "utf8",
      ),
    );
  for (const id of ["a", "b"])
    sql
      .prepare("INSERT INTO user VALUES (?,?,?,1,NULL,?,?)")
      .run(id, id, `${id}@example.com`, Date.now(), Date.now());
  env = {
    DB: d1(sql),
    APP_ORIGIN: "https://ego.example",
    BETTER_AUTH_SECRET: "auth-secret",
    AUTH_LIMIT: { limit: async () => ({ success: true }) },
  } as unknown as Bindings;
});
afterEach(async () => {
  await Promise.allSettled(pending);
  sql.close();
});
async function request(path: string, body?: unknown) {
  return app.fetch(
    new Request(`https://ego.example/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: "https://ego.example",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    {
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
      passThroughOnException() {},
    } as ExecutionContext,
  );
}
async function quote() {
  const response = await request("/finance/quotes", {
    kind: "withdraw",
    asset: "USDC",
    amount: "1000000",
    destination: "Arc",
    recipient,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { quote: FinanceQuote }).quote;
}
async function submit(id: string) {
  const response = await request(`/finance/quotes/${id}/submit`, {});
  await Promise.allSettled(pending);
  return response;
}
async function status(id: string) {
  return sql
    .prepare("SELECT status FROM finance_operation WHERE id = ?")
    .get(id) as { status: string };
}
it("keeps new capabilities disabled until rollout configuration exists", async () => {
  expect(await capabilities(env)).toMatchObject({
    swap: false,
    earn: false,
    withdraw: false,
  });
  expect(
    (
      await request("/finance/quotes", {
        kind: "swap",
        asset: "USDC",
        outputAsset: "EURC",
        amount: "1",
      })
    ).status,
  ).toBe(503);
  expect(state.keys).toHaveLength(0);
});
it("validates non-EVM destination addresses without accepting zero or malformed keys", () => {
  expect(validRecipient("11111111111111111111111111111111", "solana")).toBe(
    false,
  );
  expect(
    validRecipient("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "solana"),
  ).toBe(true);
  expect(validRecipient(owner, "solana")).toBe(false);
  expect(validRecipient(`0x${"0".repeat(40)}`, "evm")).toBe(false);
});
it("does not persist credentials or error request bodies in recovery data", () => {
  expect(
    financeJson({
      apiKey: "secret",
      config: { kitKey: "secret", maxFee: "1" },
      steps: [
        { error: { headers: { Authorization: "secret" } }, state: "pending" },
      ],
      amount: 1n,
    }),
  ).toBe(
    '{"config":{"maxFee":"1"},"steps":[{"state":"pending"}],"amount":"1"}',
  );
});
it("rejects unsupported destinations and self-sends", async () => {
  expect(
    (
      await request("/finance/quotes", {
        kind: "withdraw",
        asset: "USDC",
        amount: "1",
        destination: "Unknown",
        recipient,
      })
    ).status,
  ).toBe(503);
  expect(
    (
      await request("/finance/quotes", {
        kind: "withdraw",
        asset: "USDC",
        amount: "1",
        destination: "Arc",
        recipient: owner,
      })
    ).status,
  ).toBe(400);
});
it("quotes raw integer input and enforces native gas reserves", async () => {
  const q = await quote();
  expect(q.request.amount).toBe("1000000");
  expect(q.networkFeeCap).toBe("4000000000000000");
  state.native = 1000000n;
  expect(
    (
      await request("/finance/quotes", {
        kind: "withdraw",
        asset: "USDC",
        amount: "1",
        destination: "Arc",
        recipient,
      })
    ).status,
  ).toBe(409);
});
it("rejects expired quotes and requires recent verification", async () => {
  const q = await quote();
  state.createdAt = Date.now() - 360000;
  expect((await submit(q.id)).status).toBe(401);
  state.createdAt = Date.now();
  sql.prepare("UPDATE finance_quote SET expires_at = 0 WHERE id = ?").run(q.id);
  expect((await submit(q.id)).status).toBe(409);
  expect(state.keys).toHaveLength(0);
});
it("isolates quotes and operation reads by authenticated account", async () => {
  const q = await quote();
  await submit(q.id);
  state.user = "b";
  expect((await submit(q.id)).status).toBe(404);
  expect((await request(`/finance/operations/${q.id}`)).status).toBe(404);
});
it("shares the wallet lock with existing campaign and send operations", async () => {
  const q = await quote();
  sql
    .prepare("INSERT INTO wallet_lock VALUES ('a','campaign-operation')")
    .run();
  expect((await submit(q.id)).status).toBe(409);
  expect(state.keys).toHaveLength(0);
});
it("persists intent and reuses one idempotency key after a lost submission response", async () => {
  const q = await quote();
  state.uncertain = true;
  await submit(q.id);
  expect((await status(q.id)).status).toBe("pending");
  const step = sql
    .prepare(
      "SELECT idempotency_key,transaction_id FROM finance_step WHERE operation_id = ?",
    )
    .get(q.id) as { idempotency_key: string; transaction_id: string | null };
  expect(step.transaction_id).toBeNull();
  expect(step.idempotency_key).toBe(state.keys[0]);
  await reconcileFinance(env, q.id);
  expect(state.keys).toHaveLength(2);
  expect(new Set(state.keys).size).toBe(1);
  expect(state.transactions.size).toBe(1);
});
it("confirms only the matching onchain transaction and releases the lock", async () => {
  const q = await quote();
  await submit(q.id);
  state.complete = true;
  state.wrongInput = true;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("pending");
  state.wrongInput = false;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("confirmed");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
  await reconcileFinance(env, q.id);
  await submit(q.id);
  expect(state.transactions.size).toBe(1);
});
it("does not submit twice when reconciliation handlers race", async () => {
  const q = await quote();
  await submit(q.id);
  await Promise.all([reconcileFinance(env, q.id), reconcileFinance(env, q.id)]);
  expect(state.keys).toHaveLength(1);
});
it("uses the saved recipient even if submission includes replacement parameters", async () => {
  const q = await quote();
  await request(`/finance/quotes/${q.id}/submit`, {
    recipient: owner,
    amount: "99",
  });
  await Promise.allSettled(pending);
  expect([...state.transactions.values()][0].callData).toContain(
    recipient.slice(2),
  );
});
it("releases a rejected pre-submission operation for a new review", async () => {
  const q = await quote();
  state.providerError = true;
  await submit(q.id);
  expect((await status(q.id)).status).toBe("needs-review");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
});

it("recovers a burned withdrawal without another source payment and waits for destination delivery", async () => {
  env.FINANCE_FEATURES = "withdraw";
  env.FINANCE_BRIDGE_ROUTES = "Base:USDC";
  const response = await request("/finance/quotes", {
    kind: "withdraw",
    asset: "USDC",
    amount: "1000000",
    destination: "Base",
    recipient,
  });
  expect(response.status).toBe(200);
  const q = ((await response.json()) as { quote: FinanceQuote }).quote;
  await submit(q.id);
  state.complete = true;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("pending");
  state.forwarded = true;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("confirmed");
  expect(state.recovered).toBe(true);
  expect(state.transactions.size).toBe(1);
});

it("rejects insufficient EURC independently of USDC gas funds", async () => {
  state.token = 0n;
  const response = await request("/finance/quotes", {
    kind: "withdraw",
    asset: "EURC",
    amount: "1",
    destination: "Arc",
    recipient,
  });
  expect(response.status).toBe(409);
  expect(state.keys).toHaveLength(0);
});
it("rejects slippage outside the reviewed range or fractional basis points", async () => {
  env.FINANCE_FEATURES = "swap";
  for (const slippageBps of [9, 301, 50.5]) {
    expect(
      (
        await request("/finance/quotes", {
          kind: "swap",
          asset: "USDC",
          outputAsset: "EURC",
          amount: "1",
          slippageBps,
        })
      ).status,
    ).toBe(400);
  }
  expect(state.keys).toHaveLength(0);
});
it("never exceeds the reviewed gas cap or broadcasts when estimation exceeds it", async () => {
  const q = await quote();
  state.gas = 2000000n;
  await submit(q.id);
  expect((await status(q.id)).status).toBe("needs-review");
  expect(state.keys).toHaveLength(0);
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
});
it("releases a definitively rejected first submission", async () => {
  const q = await quote();
  state.rejected = true;
  await submit(q.id);
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("failed");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
});
it("retains a reservation when a rejection follows an uncertain submission", async () => {
  const q = await quote();
  state.uncertain = true;
  await submit(q.id);
  state.rejected = true;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("pending");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeDefined();
  expect(state.transactions.size).toBe(1);
});
it("does not replay an old unknown submission after the conservative recovery window", async () => {
  const q = await quote();
  state.uncertain = true;
  await submit(q.id);
  sql
    .prepare("UPDATE finance_step SET created_at = ?")
    .run(Date.now() - 3600001);
  await reconcileFinance(env, q.id);
  expect(state.keys).toHaveLength(1);
  expect((await status(q.id)).status).toBe("pending");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeDefined();
});
it("reports an onchain revert as failed and unlocks without retrying payment", async () => {
  const q = await quote();
  await submit(q.id);
  state.complete = true;
  state.reverted = true;
  await reconcileFinance(env, q.id);
  expect((await status(q.id)).status).toBe("failed");
  expect(sql.prepare("SELECT * FROM wallet_lock").get()).toBeUndefined();
  await reconcileFinance(env, q.id);
  expect(state.transactions.size).toBe(1);
});

it("keeps unverified swap pairs unavailable even when swapping is configured", async () => {
  env.FINANCE_FEATURES = "swap";
  const input = {
    kind: "swap",
    asset: "USDC",
    outputAsset: "EURC",
    amount: "1",
  };
  expect((await request("/finance/quotes", input)).status).toBe(409);
  expect(state.keys).toHaveLength(0);
});

it("does not broadcast when asynchronous preparation finishes after execution times out", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  try {
    const q = await quote();
    state.gasPause = new Promise<void>((resolve) => {
      release = resolve;
    });
    expect((await request(`/finance/quotes/${q.id}/submit`, {})).status).toBe(
      202,
    );
    await vi.advanceTimersByTimeAsync(15001);
    await Promise.allSettled(pending);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.keys).toHaveLength(0);
    expect(sql.prepare("SELECT * FROM finance_step").get()).toBeUndefined();
    expect((await status(q.id)).status).toBe("pending");
  } finally {
    release?.();
    vi.useRealTimers();
  }
});
