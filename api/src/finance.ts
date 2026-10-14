import type { Hono } from "hono";
import { z } from "zod";
import { decodeEventLog, formatUnits, type Address, type Hex } from "viem";
import {
  walletAssets,
  assetAmount,
  assetDefinition,
  assetUnits,
  type FinanceRequest,
  type FinanceQuote,
  type FinanceOperation,
} from "@ego/chain";
import type { AppEnvironment, Bindings } from "./env";
import { circle, ensureWallet, rpc } from "./circle";
import { requireRecentAuth, maximumFee, type AbsoluteFee } from "./spends";
import { ApiError } from "./http";
import {
  capabilities,
  swapPairs,
  destinationChains,
  enabled,
  earnSummary,
  listEarnVaults,
  executeProvider,
  financeJson,
  providerQuote,
  tokenAbi,
  validRecipient,
  verifyAssets,
  type PreparedCall,
  type Wallet,
} from "./finance-provider";

type QuoteRow = {
  id: string;
  user_id: string;
  request: string;
  review: string;
  fee: string;
  expires_at: number;
  created_at: number;
};
type Job = {
  id: string;
  user_id: string;
  status: FinanceOperation["status"];
  recovery: string | null;
  received: string | null;
  destination_hash: string | null;
  error: string | null;
  lease_until: number;
  created_at: number;
  updated_at: number;
};
type Step = {
  id: string;
  operation_id: string;
  phase: string;
  call: string;
  fee: string;
  idempotency_key: string;
  transaction_id: string | null;
  attempts: number;
  created_at: number;
  hash: string | null;
  status: string;
};
type Review = FinanceQuote & { providerQuote?: unknown; vaultAddress?: string };
const requestSchema = z
  .object({
    kind: z.enum(["withdraw", "swap", "earn-deposit", "earn-withdraw"]),
    asset: z.enum(["USDC", "EURC", "cirBTC"]),
    amount: z.string().regex(/^[1-9]\d{0,29}$/),
    outputAsset: z.enum(["USDC", "EURC", "cirBTC"]).optional(),
    destination: z.string().min(1).max(60).optional(),
    recipient: z.string().min(1).max(100).optional(),
    slippageBps: z.number().int().min(10).max(300).default(50),
  })
  .strict();
const approvalSelector = "0x095ea7b3";
const feeBudgetGas = 2_000_000n;
class Deferred extends Error {}
function feature(request: FinanceRequest) {
  return request.kind.startsWith("earn-") ? "earn" : request.kind;
}
export function validateRequest(
  request: FinanceRequest,
  wallet: { address: string },
  env: Bindings,
) {
  if (
    request.kind === "swap" &&
    (!request.outputAsset || request.outputAsset === request.asset)
  )
    throw new ApiError("INVALID_REQUEST");
  if (
    request.kind === "swap" &&
    !swapPairs(env).some(
      (pair) => pair.from === request.asset && pair.to === request.outputAsset,
    )
  )
    throw new ApiError("UNSUPPORTED_ROUTE", 409);
  if (request.kind.startsWith("earn-") && request.asset !== "USDC")
    throw new ApiError("INVALID_REQUEST");
  if (request.kind === "withdraw") {
    if (!["USDC", "EURC"].includes(request.asset))
      throw new ApiError("INVALID_REQUEST");
    const route =
      request.destination === "Arc"
        ? { type: "evm" }
        : destinationChains(env).find(
            (c) =>
              c.id === request.destination &&
              c.assets.includes(request.asset as "USDC" | "EURC"),
          );
    if (!route) throw new ApiError("UNSUPPORTED_ROUTE", 409);
    if (
      !request.recipient ||
      !validRecipient(request.recipient, route.type) ||
      (request.destination === "Arc" &&
        request.recipient.toLowerCase() === wallet.address.toLowerCase()) ||
      request.recipient.toLowerCase() ===
        assetDefinition(request.asset).address.toLowerCase()
    )
      throw new ApiError("INVALID_RECIPIENT");
  }
}
export async function sufficientAssets(
  env: Bindings,
  userId: string,
  request: FinanceRequest,
  fee: AbsoluteFee,
) {
  const wallet = await ensureWallet(env, userId),
    client = rpc(env);
  const gas = maximumFee(fee),
    spending = request.kind === "earn-withdraw" ? 0n : BigInt(request.amount);
  const native = await client.getBalance({
    address: wallet.address as Address,
  });
  if (native < gas + (request.asset === "USDC" ? spending * 10n ** 12n : 0n))
    throw new ApiError("INSUFFICIENT_BALANCE", 409);
  if (request.asset !== "USDC") {
    const balance = await client.readContract({
      address: assetDefinition(request.asset).address,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [wallet.address as Address],
    });
    if (balance < spending) throw new ApiError("INSUFFICIENT_BALANCE", 409);
  }
}
const steps = async (env: Bindings, id: string) =>
  (
    await env.DB.prepare(
      "SELECT * FROM finance_step WHERE operation_id = ? ORDER BY created_at,id",
    )
      .bind(id)
      .all<Step>()
  ).results;
async function publicJob(env: Bindings, job: Job): Promise<FinanceOperation> {
  const quote = await env.DB.prepare("SELECT * FROM finance_quote WHERE id = ?")
    .bind(job.id)
    .first<QuoteRow>();
  const request = JSON.parse(quote!.request) as FinanceRequest,
    review = JSON.parse(quote!.review) as Review;
  const transactions = (await steps(env, job.id))
    .filter((s) => s.hash)
    .map((s) => ({
      phase: s.phase.startsWith("approve") ? "Approval" : "Source",
      hash: s.hash!,
      url: `https://explorer.arc.io/tx/${s.hash}`,
    }));
  if (job.destination_hash && request.destination !== "Arc") {
    const chain = destinationChains(env).find(
      (c) => c.id === request.destination,
    )?.definition;
    if (chain)
      transactions.push({
        phase: "Destination",
        hash: job.destination_hash,
        url: chain.explorerUrl.replace("{hash}", job.destination_hash),
      });
  }
  return {
    id: job.id,
    kind: request.kind,
    asset: request.asset,
    amount: request.amount,
    outputAsset: review.outputAsset,
    status: job.status,
    recipient: request.recipient,
    destination: request.destination,
    createdAt: job.created_at,
    error: job.error,
    received: job.received ? JSON.parse(job.received) : undefined,
    minimumReceived: review.minimumReceived,
    outputDecimals: review.outputDecimals,
    transactions,
  };
}
async function finish(
  env: Bindings,
  id: string,
  status: Job["status"],
  error: string | null = null,
) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE finance_operation SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(status, error, Date.now(), id),
    env.DB.prepare(
      "DELETE FROM wallet_lock WHERE operation_id = ? AND EXISTS (SELECT 1 FROM finance_operation WHERE id = ? AND status != 'pending')",
    ).bind(id, id),
  ]);
}
export async function reconcileFinanceStep(
  env: Bindings,
  step: Step,
  wallet: Wallet,
  beforeSubmit?: () => Promise<void>,
) {
  if (step.status !== "pending") return step;
  const call = JSON.parse(step.call) as PreparedCall;
  if (!step.transaction_id) {
    // Never replay a long-uncertain submission beyond a conservative recovery
    // window: the provider may eventually expire its idempotency record.
    if (step.attempts > 0 && Date.now() - step.created_at > 60 * 60_000)
      throw new Deferred();
    await env.DB.prepare(
      "UPDATE finance_step SET attempts = attempts + 1 WHERE id = ?",
    )
      .bind(step.id)
      .run();
    await beforeSubmit?.();
    let response;
    try {
      response = await circle(env).createContractExecutionTransaction({
        walletId: wallet.id,
        contractAddress: call.to,
        callData: call.data,
        amount: formatUnits(BigInt(call.value), 18),
        idempotencyKey: step.idempotency_key,
        fee: JSON.parse(step.fee) as AbsoluteFee,
      });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      // A rejection is definitive only on the first attempt. A prior process
      // could have lost its response after submission, even before recording it.
      if (
        step.attempts === 0 &&
        status &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        await env.DB.prepare(
          "UPDATE finance_step SET status = 'failed' WHERE id = ? AND transaction_id IS NULL",
        )
          .bind(step.id)
          .run();
        return { ...step, status: "failed" };
      }
      throw new Deferred();
    }
    const id = response.data?.id;
    if (!id) throw new Deferred();
    await env.DB.prepare(
      "UPDATE finance_step SET transaction_id = ? WHERE id = ? AND transaction_id IS NULL",
    )
      .bind(id, step.id)
      .run();
    step = { ...step, transaction_id: id };
  }
  const tx = (await circle(env).getTransaction({ id: step.transaction_id! }))
    .data?.transaction;
  if (!tx) throw new Deferred();
  let status = "pending";
  if (tx.txHash) {
    // A receipt lookup failure is uncertain, including when Circle reports failure.
    const receipt = await rpc(env).getTransactionReceipt({
      hash: tx.txHash as Hex,
    });
    if (receipt.to?.toLowerCase() !== call.to.toLowerCase())
      throw new Deferred();
    const transaction = await rpc(env).getTransaction({
      hash: tx.txHash as Hex,
    });
    if (
      transaction.from.toLowerCase() !== wallet.address.toLowerCase() ||
      transaction.input.toLowerCase() !== call.data.toLowerCase() ||
      transaction.value !== BigInt(call.value)
    )
      throw new Deferred();
    status = receipt.status === "success" ? "confirmed" : "failed";
  } else if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state))
    status = "failed";
  if (status !== "pending") {
    await env.DB.prepare(
      "UPDATE finance_step SET status = ?, hash = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(status, tx.txHash || null, step.id)
      .run();
    return { ...step, status, hash: tx.txHash || null };
  }
  throw new Deferred();
}
export async function reconcileFinance(env: Bindings, id: string) {
  const now = Date.now(),
    lease = now + 120_000;
  const acquired = await env.DB.prepare(
    "UPDATE finance_operation SET lease_until = ? WHERE id = ? AND status = 'pending' AND lease_until < ?",
  )
    .bind(lease, id, now)
    .run();
  if (!acquired.meta.changes) return;
  try {
    const job = (await env.DB.prepare(
      "SELECT * FROM finance_operation WHERE id = ?",
    )
      .bind(id)
      .first<Job>())!;
    const quote = (await env.DB.prepare(
      "SELECT * FROM finance_quote WHERE id = ?",
    )
      .bind(id)
      .first<QuoteRow>())!;
    const request = JSON.parse(quote.request) as FinanceRequest,
      review = JSON.parse(quote.review) as Review;
    const wallet = await ensureWallet(env, job.user_id);
    const current = await steps(env, id);
    for (let step of current) {
      step = await reconcileFinanceStep(env, step, wallet);
      if (step.status === "failed") {
        await finish(env, id, "failed", "TRANSACTION_FAILED");
        return;
      }
    }
    // A completed financial call is never submitted again. For same-chain
    // operations validate its receipt rather than obtaining a new SDK payload.
    const execution = (await steps(env, id)).find(
      (s) => s.phase === "execute" && s.status === "confirmed",
    );
    if (
      execution &&
      !(request.kind === "withdraw" && request.destination !== "Arc")
    ) {
      const receipt = await rpc(env).getTransactionReceipt({
        hash: execution.hash as Hex,
      });
      const outputAddress =
        request.kind === "earn-deposit"
          ? review.vaultAddress!
          : assetDefinition(review.outputAsset).address;
      let received = 0n;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== outputAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: tokenAbi,
            data: log.data,
            topics: log.topics,
            eventName: "Transfer",
          });
          const recipient =
            request.kind === "withdraw" ? request.recipient! : wallet.address;
          if (decoded.args.to.toLowerCase() === recipient.toLowerCase())
            received += decoded.args.value;
        } catch {
          /* Ignore unrelated logs. */
        }
      }
      const minimum =
        request.kind === "earn-deposit" ? 1n : BigInt(review.minimumReceived);
      if (received < minimum) throw new Deferred();
      const decimals =
        request.kind === "earn-deposit"
          ? await rpc(env).readContract({
              address: review.vaultAddress! as Address,
              abi: tokenAbi,
              functionName: "decimals",
            })
          : review.outputDecimals;
      await env.DB.prepare(
        "UPDATE finance_operation SET received = ? WHERE id = ?",
      )
        .bind(
          JSON.stringify({
            units: received.toString(),
            decimals,
            symbol:
              request.kind === "earn-deposit"
                ? "vault shares"
                : review.outputAsset,
          }),
          id,
        )
        .run();
      await finish(env, id, "confirmed");
      return;
    }
    let acceptingCalls = true;
    const assertLease = async () => {
      const owner = await env.DB.prepare(
        "SELECT lease_until FROM finance_operation WHERE id = ?",
      )
        .bind(id)
        .first<{ lease_until: number }>();
      if (
        !acceptingCalls ||
        owner?.lease_until !== lease ||
        Date.now() >= lease
      )
        throw new Deferred();
    };
    const execute = async (call: PreparedCall) => {
      await assertLease();
      const approval = call.data.startsWith(approvalSelector);
      const phase = approval
        ? `approve:${call.to.toLowerCase()}:${call.data.toLowerCase()}`
        : "execute";
      let saved = await env.DB.prepare(
        "SELECT * FROM finance_step WHERE operation_id = ? AND phase = ?",
      )
        .bind(id, phase)
        .first<Step>();
      if (saved) {
        const checked = await reconcileFinanceStep(env, saved, wallet);
        if (checked.status !== "confirmed" || !checked.hash)
          throw new Deferred();
        return checked.hash;
      }
      if (Date.now() >= quote.expires_at)
        throw new ApiError("QUOTE_EXPIRED", 409);
      if (!/^0x[0-9a-fA-F]{40}$/.test(call.to) || BigInt(call.value) !== 0n)
        throw new ApiError("UNSUPPORTED_TRANSACTION", 409);
      if (approval) {
        // Never grant an unbounded allowance, or approve an unrelated asset.
        const token =
          request.kind === "earn-withdraw"
            ? review.vaultAddress!
            : assetDefinition(request.asset).address;
        if (
          call.to.toLowerCase() !== token.toLowerCase() ||
          BigInt(`0x${call.data.slice(-64)}`) === (1n << 256n) - 1n ||
          (request.kind !== "earn-withdraw" &&
            BigInt(`0x${call.data.slice(-64)}`) > BigInt(request.amount))
        )
          throw new ApiError("UNSUPPORTED_TRANSACTION", 409);
      }
      const fee = JSON.parse(quote.fee) as AbsoluteFee;
      const client = rpc(env);
      const gas =
        ((await client.estimateGas({
          account: wallet.address as Address,
          to: call.to,
          data: call.data,
        })) *
          12n) /
          10n +
        10000n;
      const spentGas = (await steps(env, id)).reduce(
        (sum, s) =>
          sum + BigInt((JSON.parse(s.fee) as AbsoluteFee).config.gasLimit),
        0n,
      );
      if (spentGas + gas > BigInt(fee.config.gasLimit))
        throw new ApiError("FEE_CAP_EXCEEDED", 409);
      // The reviewed gas price is a cap, not permission to silently increase it.
      await sufficientAssets(env, job.user_id, request, {
        ...fee,
        config: {
          ...fee.config,
          gasLimit: (BigInt(fee.config.gasLimit) - spentGas).toString(),
        },
      });
      const stepFee = {
        ...fee,
        config: { ...fee.config, gasLimit: gas.toString() },
      };
      await assertLease();
      const stepId = crypto.randomUUID(),
        key = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO finance_step (id,operation_id,phase,call,fee,idempotency_key,status,created_at) VALUES (?,?,?,?,?,?,'pending',?) ON CONFLICT(operation_id,phase) DO NOTHING",
      )
        .bind(
          stepId,
          id,
          phase,
          JSON.stringify(call),
          JSON.stringify(stepFee),
          key,
          Date.now(),
        )
        .run();
      saved = (await env.DB.prepare(
        "SELECT * FROM finance_step WHERE operation_id = ? AND phase = ?",
      )
        .bind(id, phase)
        .first<Step>())!;
      await reconcileFinanceStep(env, saved, wallet, assertLease);
      throw new Deferred();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      executeProvider(
        request.kind.startsWith("earn-")
          ? { ...env, EARN_VAULT_ADDRESS: review.vaultAddress }
          : env,
        wallet,
        request,
        assetAmount(review.minimumReceived, review.outputDecimals),
        review.providerQuote,
        job.recovery,
        execute,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          acceptingCalls = false;
          reject(new Deferred());
        }, 15_000);
      }),
    ]).finally(() => {
      acceptingCalls = false;
      clearTimeout(timer);
    });
    if (result.recovery)
      await env.DB.prepare(
        "UPDATE finance_operation SET recovery = ?, destination_hash = ?, updated_at = ? WHERE id = ?",
      )
        .bind(result.recovery, result.hash || null, Date.now(), id)
        .run();
    if (result.complete && execution) {
      // Forwarder success must include a confirmed destination transaction.
      await finish(env, id, "confirmed");
    } else if (
      !(await steps(env, id)).some((s) => s.status === "pending") &&
      Date.now() > quote.expires_at &&
      !execution
    ) {
      await finish(env, id, "needs-review", "QUOTE_EXPIRED");
    }
  } catch (error) {
    const current = await steps(env, id);
    if (
      !(error instanceof Deferred) &&
      !current.some((s) => s.phase === "execute" || s.status === "pending")
    )
      await finish(
        env,
        id,
        "needs-review",
        error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE",
      );
    // All other uncertain outcomes stay pending for reconciliation. No SDK error
    // bodies are logged: they may carry credentials and signed payloads.
  } finally {
    await env.DB.prepare(
      "UPDATE finance_operation SET lease_until = 0, updated_at = ? WHERE id = ? AND lease_until = ?",
    )
      .bind(Date.now(), id, lease)
      .run();
  }
}
export async function reconcileFinances(env: Bindings) {
  const jobs = (
    await env.DB.prepare(
      "SELECT id FROM finance_operation WHERE status = 'pending' AND lease_until < ? ORDER BY updated_at LIMIT 10",
    )
      .bind(Date.now())
      .all<{ id: string }>()
  ).results;
  for (const job of jobs) await reconcileFinance(env, job.id);
}
export function registerFinanceRoutes(app: Hono<AppEnvironment>) {
  app.get("/v1/wallet/capabilities", async (c) =>
    c.json(await capabilities(c.env)),
  );
  app.get("/v1/earn/vaults", async (c) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(c.req.query("page") || 1);
    return c.json(await listEarnVaults(c.env, page));
  });
  app.get("/v1/earn", async (c) => {
    if (!enabled(c.env, "earn")) throw new ApiError("FINANCE_UNAVAILABLE", 503);
    await verifyAssets(c.env);
    return c.json(
      await earnSummary(c.env, await ensureWallet(c.env, c.get("user").id)),
    );
  });
  app.use("/v1/finance/*", async (c, next) => {
    if (
      c.req.method === "POST" &&
      !(await c.env.AUTH_LIMIT.limit({ key: `finance:${c.get("user").id}` }))
        .success
    )
      throw new ApiError("RATE_LIMITED", 429);
    await next();
  });
  app.post("/v1/finance/quotes", async (c) => {
    const request = requestSchema.parse(await c.req.json());
    // Arc-only direct transfers need no bridge rollout permission.
    if (
      !(request.kind === "withdraw" && request.destination === "Arc") &&
      !enabled(c.env, feature(request))
    )
      throw new ApiError("FINANCE_UNAVAILABLE", 503);
    await verifyAssets(c.env);
    const wallet = await ensureWallet(c.env, c.get("user").id);
    validateRequest(request, wallet, c.env);
    const estimate = await providerQuote(c.env, wallet, request);
    const prices = await rpc(c.env).estimateFeesPerGas();
    const fee: AbsoluteFee = {
      type: "absolute",
      config: {
        maxFee: formatUnits(prices.maxFeePerGas * 2n, 9),
        priorityFee: formatUnits(prices.maxPriorityFeePerGas, 9),
        gasLimit: feeBudgetGas.toString(),
      },
    };
    await sufficientAssets(c.env, c.get("user").id, request, fee);
    const now = Date.now(),
      id = crypto.randomUUID();
    const quote: FinanceQuote = {
      id,
      request,
      sourceChainId: 5042,
      expiresAt: now + 60_000,
      estimatedReceived: assetUnits(
        estimate.expected,
        assetDefinition(estimate.output).decimals,
      ),
      minimumReceived: assetUnits(
        estimate.minimum,
        assetDefinition(estimate.output).decimals,
      ),
      outputAsset: estimate.output,
      assetDecimals: assetDefinition(request.asset).decimals,
      outputDecimals: assetDefinition(estimate.output).decimals,
      fees: estimate.fees.map((f) => {
        const asset = walletAssets.find(
          (a) =>
            a.symbol.toLowerCase() === f.symbol.toLowerCase() ||
            a.address.toLowerCase() === f.symbol.toLowerCase(),
        );
        if (!asset) throw new ApiError("FEE_UNAVAILABLE", 503);
        return {
          ...f,
          symbol: asset.symbol,
          decimals: asset.decimals,
          amount: assetUnits(f.amount, asset.decimals),
        };
      }),
      networkFeeCap: maximumFee(fee).toString(),
      networkFeeDecimals: 18,
      timing:
        request.kind === "withdraw" && request.destination !== "Arc"
          ? "Depends on source finality and destination delivery; track progress in Activity."
          : "After transaction confirmation.",
    };
    await c.env.DB.prepare(
      "INSERT INTO finance_quote (id,user_id,request,review,fee,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        c.get("user").id,
        JSON.stringify(request),
        financeJson({
          ...quote,
          providerQuote: estimate.providerQuote,
          ...(request.kind.startsWith("earn-")
            ? { vaultAddress: c.env.EARN_VAULT_ADDRESS }
            : {}),
        }),
        JSON.stringify(fee),
        quote.expiresAt,
        now,
      )
      .run();
    return c.json({ quote });
  });
  app.post("/v1/finance/quotes/:id/submit", async (c) => {
    const quote = await c.env.DB.prepare(
      "SELECT * FROM finance_quote WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<QuoteRow>();
    if (!quote) throw new ApiError("TRANSACTION_NOT_FOUND", 404);
    const existing = await c.env.DB.prepare(
      "SELECT * FROM finance_operation WHERE id = ?",
    )
      .bind(quote.id)
      .first<Job>();
    if (existing)
      return c.json({ operation: await publicJob(c.env, existing) });
    requireRecentAuth(c.get("sessionCreatedAt"));
    if (Date.now() >= quote.expires_at)
      throw new ApiError("QUOTE_EXPIRED", 409);
    const request = JSON.parse(quote.request) as FinanceRequest;
    if (
      !(request.kind === "withdraw" && request.destination === "Arc") &&
      !enabled(c.env, feature(request))
    )
      throw new ApiError("FINANCE_UNAVAILABLE", 503);
    await sufficientAssets(
      c.env,
      c.get("user").id,
      request,
      JSON.parse(quote.fee),
    );
    try {
      const now = Date.now();
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO wallet_lock (user_id,operation_id) VALUES (?,?)",
        ).bind(c.get("user").id, quote.id),
        c.env.DB.prepare(
          "INSERT INTO finance_operation (id,user_id,status,created_at,updated_at) VALUES (?,?,'pending',?,?)",
        ).bind(quote.id, c.get("user").id, now, now),
      ]);
    } catch {
      const concurrent = await c.env.DB.prepare(
        "SELECT * FROM finance_operation WHERE id = ?",
      )
        .bind(quote.id)
        .first<Job>();
      if (concurrent)
        return c.json({ operation: await publicJob(c.env, concurrent) });
      throw new ApiError("WALLET_BUSY", 409);
    }
    c.executionCtx.waitUntil(reconcileFinance(c.env, quote.id));
    const job = (await c.env.DB.prepare(
      "SELECT * FROM finance_operation WHERE id = ?",
    )
      .bind(quote.id)
      .first<Job>())!;
    return c.json({ operation: await publicJob(c.env, job) }, 202);
  });
  app.get("/v1/finance/operations", async (c) => {
    const jobs = (
      await c.env.DB.prepare(
        "SELECT * FROM finance_operation WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(c.get("user").id)
        .all<Job>()
    ).results;
    return c.json({
      operations: await Promise.all(jobs.map((job) => publicJob(c.env, job))),
    });
  });
  app.get("/v1/finance/operations/:id", async (c) => {
    const job = await c.env.DB.prepare(
      "SELECT * FROM finance_operation WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<Job>();
    if (!job) throw new ApiError("TRANSACTION_NOT_FOUND", 404);
    if (job.status === "pending")
      c.executionCtx.waitUntil(reconcileFinance(c.env, job.id));
    return c.json({ operation: await publicJob(c.env, job) });
  });
}
