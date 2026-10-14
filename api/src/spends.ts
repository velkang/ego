import type { Hono } from "hono";
import { z } from "zod";
import {
  parseUnits,
  formatUnits,
  isAddress,
  decodeEventLog,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { USDC_ADDRESS } from "@jovva/chain";
import type { AppEnvironment, Bindings } from "./env";
import type { EventRow } from "./db";
import { circle, rpc, contractTransaction, ensureWallet } from "./circle";
import { ApiError } from "./http";
import {
  campaignTransaction,
  launchPhases,
  type CampaignAction,
} from "./campaign-transaction";
export type AbsoluteFee = {
  type: "absolute";
  config: { maxFee: string; priorityFee: string; gasLimit: string };
};
export function requireRecentAuth(createdAt: number) {
  if (!createdAt || Date.now() - createdAt > 5 * 60_000)
    throw new ApiError("REAUTH_REQUIRED", 401);
}
export function maximumFee(fee: AbsoluteFee) {
  return parseUnits(fee.config.maxFee, 9) * BigInt(fee.config.gasLimit);
}
export async function sufficientBalance(
  env: Bindings,
  address: string,
  amount: number,
  fee: bigint,
) {
  const balance = await rpc(env).getBalance({ address: address as Address });
  if (balance < BigInt(amount) * 10n ** 12n + fee)
    throw new ApiError("INSUFFICIENT_BALANCE", 409);
}
export type CampaignFeeQuote = {
  action: CampaignAction;
  fees: Record<string, AbsoluteFee>;
};
export function campaignFees(
  value: string | null | undefined,
): CampaignFeeQuote {
  const quote = value ? (JSON.parse(value) as CampaignFeeQuote) : null;
  if (!quote?.action || !quote.fees) throw new ApiError("QUOTE_EXPIRED", 409);
  return quote;
}
export async function fundingQuote(
  env: Bindings,
  event: EventRow,
  action: CampaignAction = "launch",
) {
  if (!event.creator_id || !event.funding_address || !event.funding_wallet_id)
    throw new ApiError("WALLET_UNAVAILABLE", 503);
  const client = rpc(env);
  const estimate = await client.estimateFeesPerGas();
  const phases = action === "launch" ? launchPhases : [action];
  const fees: Record<string, AbsoluteFee> = {};
  for (const phase of phases) {
    // Funding and activation cannot be simulated until registration is mined.
    let gas = phase === "activate" ? 100000n : 200000n;
    if (phase === "create" || action !== "launch") {
      const call = await campaignTransaction(env, event, phase);
      gas =
        ((await client.estimateGas({
          account: event.funding_address as Address,
          to: call.address,
          data: encodeFunctionData({
            abi: parseAbi([`function ${call.signature}`] as string[]),
            functionName: call.signature.split("(")[0],
            args: call.parameters,
          }),
        })) *
          12n) /
          10n +
        10000n;
    }
    fees[phase] = {
      type: "absolute",
      config: {
        maxFee: formatUnits(estimate.maxFeePerGas * 2n, 9),
        priorityFee: formatUnits(estimate.maxPriorityFeePerGas, 9),
        gasLimit: String(gas),
      },
    };
  }
  const totalFee = Object.values(fees).reduce(
    (sum, fee) => sum + maximumFee(fee),
    0n,
  );
  const amount = action === "launch" ? event.budget : 0;
  await sufficientBalance(env, event.funding_address, amount, totalFee);
  return {
    amount,
    fee: formatUnits(totalFee, 18),
    parameters: { action, fees } satisfies CampaignFeeQuote,
  };
}

type Spend = {
  id: string;
  user_id: string;
  recipient: string;
  amount: number;
  fee: string;
  idempotency_key: string;
  transaction_id: string | null;
  transaction_hash: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  error: string | null;
};
export const publicSpend = (row: Spend) => ({
  id: row.id,
  recipient: row.recipient,
  amount: row.amount,
  status: row.status,
  transactionHash: row.transaction_hash,
  error: row.error,
  createdAt: row.created_at,
  fee: formatUnits(maximumFee(JSON.parse(row.fee)), 18),
});
export async function reconcileSpend(env: Bindings, row: Spend) {
  if (row.status !== "pending") return;
  if (!row.transaction_id) {
    const wallet = await ensureWallet(env, row.user_id);
    const transactionId = await contractTransaction(
      env,
      "transfer(address,uint256)",
      [row.recipient, String(row.amount)],
      row.idempotency_key,
      USDC_ADDRESS,
      wallet.id,
      JSON.parse(row.fee),
    );
    await env.DB.prepare(
      "UPDATE spend SET transaction_id = ?,updated_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(transactionId, Date.now(), row.id)
      .run();
    row = { ...row, transaction_id: transactionId };
  }
  const tx = (await circle(env).getTransaction({ id: row.transaction_id! }))
    .data?.transaction;
  if (!tx) return;
  let state: string | null = null;
  if (tx.state === "COMPLETE" && tx.txHash) {
    const receipt = await rpc(env).getTransactionReceipt({
      hash: tx.txHash as Hex,
    });
    const wallet = await ensureWallet(env, row.user_id);
    const matches = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase())
        return false;
      try {
        const decoded = decodeEventLog({
          abi: parseAbi([
            "event Transfer(address indexed from,address indexed to,uint256 value)",
          ]),
          data: log.data,
          topics: log.topics,
        });
        return (
          decoded.args.from.toLowerCase() === wallet.address.toLowerCase() &&
          decoded.args.to.toLowerCase() === row.recipient.toLowerCase() &&
          decoded.args.value === BigInt(row.amount)
        );
      } catch {
        return false;
      }
    });
    if (receipt.status !== "success" || !matches)
      throw new Error("Transfer receipt does not match");
    state = "confirmed";
  } else if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
    // A reported failure with a successful onchain receipt remains reserved for reconciliation.
    if (
      tx.txHash &&
      (await rpc(env).getTransactionReceipt({ hash: tx.txHash as Hex }))
        .status === "success"
    )
      return;
    state = "failed";
  }
  if (state)
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE spend SET status = ?,transaction_hash = ?,error = ?,updated_at = ? WHERE id = ? AND status = 'pending'",
      ).bind(
        state,
        tx.txHash ?? null,
        state === "failed" ? `TRANSFER_${tx.state}` : null,
        Date.now(),
        row.id,
      ),
      env.DB.prepare("DELETE FROM wallet_lock WHERE operation_id = ?").bind(
        row.id,
      ),
    ]);
}
export async function reconcileSpends(env: Bindings) {
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM spend WHERE status = 'pending' ORDER BY updated_at LIMIT 20",
    ).all<Spend>()
  ).results;
  for (const row of rows)
    try {
      await reconcileSpend(env, row);
    } catch {
      console.error(JSON.stringify({ event: "spend_pending", id: row.id }));
    }
}
export function registerSpendRoutes(app: Hono<AppEnvironment>) {
  app.use("/v1/wallet/send/*", async (c, next) => {
    if (
      c.req.method === "POST" &&
      !(await c.env.AUTH_LIMIT.limit({ key: `wallet:${c.get("user").id}` }))
        .success
    )
      throw new ApiError("RATE_LIMITED", 429);
    await next();
  });
  app.post("/v1/wallet/send/quote", async (c) => {
    const input = z
      .object({
        recipient: z.string().refine((v) => isAddress(v)),
        amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      })
      .parse(await c.req.json());
    if (
      /^0x0{40}$/i.test(input.recipient) ||
      input.recipient.toLowerCase() === USDC_ADDRESS.toLowerCase()
    )
      throw new ApiError("INVALID_RECIPIENT");
    const wallet = await ensureWallet(c.env, c.get("user").id);
    if (wallet.address.toLowerCase() === input.recipient.toLowerCase())
      throw new ApiError("INVALID_RECIPIENT");
    const response = await circle(c.env).estimateContractExecutionFee({
      source: { walletId: wallet.id },
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: "transfer(address,uint256)",
      abiParameters: [input.recipient, String(input.amount)],
    });
    const medium = response.data?.medium;
    if (!medium?.maxFee || !medium.priorityFee || !medium.gasLimit)
      throw new ApiError("FEE_UNAVAILABLE", 503);
    const fee: AbsoluteFee = {
      type: "absolute",
      config: {
        maxFee: medium.maxFee,
        priorityFee: medium.priorityFee,
        gasLimit: medium.gasLimit,
      },
    };
    await sufficientBalance(
      c.env,
      wallet.address,
      input.amount,
      maximumFee(fee),
    );
    const id = crypto.randomUUID(),
      now = Date.now();
    await c.env.DB.prepare(
      "INSERT INTO spend (id,user_id,recipient,amount,fee,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'quoted',?,?)",
    )
      .bind(
        id,
        c.get("user").id,
        input.recipient,
        input.amount,
        JSON.stringify(fee),
        crypto.randomUUID(),
        now,
        now,
      )
      .run();
    return c.json({
      quote: {
        id,
        recipient: input.recipient,
        amount: input.amount,
        fee: formatUnits(maximumFee(fee), 18),
        expiresAt: now + 60_000,
      },
    });
  });
  app.post("/v1/wallet/send/:id", async (c) => {
    requireRecentAuth(c.get("sessionCreatedAt"));
    const row = await c.env.DB.prepare(
      "SELECT * FROM spend WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<Spend>();
    if (!row) throw new ApiError("TRANSACTION_NOT_FOUND", 404);
    if (row.status !== "quoted")
      return c.json({ transaction: publicSpend(row) });
    if (Date.now() - row.created_at > 60_000)
      throw new ApiError("QUOTE_EXPIRED", 409);
    const wallet = await ensureWallet(c.env, row.user_id);
    await sufficientBalance(
      c.env,
      wallet.address,
      row.amount,
      maximumFee(JSON.parse(row.fee)),
    );
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO wallet_lock (user_id,operation_id) VALUES (?,?)",
        ).bind(row.user_id, row.id),
        c.env.DB.prepare(
          "UPDATE spend SET status = 'pending',updated_at = ? WHERE id = ? AND status = 'quoted'",
        ).bind(Date.now(), row.id),
      ]);
    } catch {
      throw new ApiError("WALLET_BUSY", 409);
    }
    c.executionCtx.waitUntil(
      reconcileSpend(c.env, { ...row, status: "pending" }).catch(() =>
        console.error(
          JSON.stringify({
            event: "spend_submission_pending",
            spendId: row.id,
          }),
        ),
      ),
    );
    return c.json(
      { transaction: publicSpend({ ...row, status: "pending" }) },
      202,
    );
  });
  app.get("/v1/wallet/transactions", async (c) =>
    c.json({
      transactions: (
        await c.env.DB.prepare(
          "SELECT * FROM spend WHERE user_id = ? AND status != 'quoted' ORDER BY created_at DESC LIMIT 100",
        )
          .bind(c.get("user").id)
          .all<Spend>()
      ).results.map(publicSpend),
    }),
  );
  app.get("/v1/wallet/transactions/:id", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT * FROM spend WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<Spend>();
    if (!row) throw new ApiError("TRANSACTION_NOT_FOUND", 404);
    c.executionCtx.waitUntil(
      reconcileSpend(c.env, row).catch(() =>
        console.error(
          JSON.stringify({ event: "spend_poll_pending", spendId: row.id }),
        ),
      ),
    );
    return c.json({ transaction: publicSpend(row) });
  });
}
