import { chainIdentifier, USDC_ADDRESS } from "@jovva/chain";
import { circle, contractTransaction, escrowAddress, rpc } from "./circle";
import type { Bindings } from "./env";
import type { EventRow, OperationRow } from "./db";
import { decodeEventLog, parseAbi, type Hex } from "viem";
import { campaignFees, maximumFee, sufficientBalance } from "./spends";
import { ApiError } from "./http";
import { campaignTransaction, launchPhases } from "./campaign-transaction";
export async function startOperation(
  env: Bindings,
  eventId: string,
  action: string,
  quoteId?: string,
) {
  const event = await env.DB.prepare("SELECT * FROM event WHERE id = ?")
    .bind(eventId)
    .first<EventRow>();
  if (!event) throw new ApiError("EVENT_NOT_FOUND", 404);
  if (quoteId) {
    const previous = await env.DB.prepare(
      "SELECT * FROM operation WHERE event_id = ? AND funding_quote_id = ?",
    )
      .bind(eventId, quoteId)
      .first<OperationRow>();
    if (previous) {
      if (previous.action !== action) throw new ApiError("QUOTE_EXPIRED", 409);
      return previous;
    }
  }
  const existing = await env.DB.prepare(
    "SELECT * FROM operation WHERE event_id = ? AND status = 'pending'",
  )
    .bind(eventId)
    .first<OperationRow>();
  if (existing) return existing;
  if (!event.creator_id || !event.funding_wallet_id || !event.funding_address)
    throw new ApiError("WALLET_UNAVAILABLE", 503);
  const quote = campaignFees(event.funding_fee);
  if (
    !quoteId ||
    quote.action !== action ||
    event.funding_quote_id !== quoteId ||
    Date.now() - (event.funding_quote_at ?? 0) > 60000
  )
    throw new ApiError("QUOTE_EXPIRED", 409);
  const valid =
    action === "launch"
      ? event.status === "draft" && event.ends_at > Date.now()
      : action === "pause"
        ? event.status === "active"
        : action === "resume"
          ? event.status === "paused"
          : action === "close"
            ? event.status !== "draft" && event.status !== "closed"
            : action === "refund"
              ? event.status === "closed" ||
                (event.status !== "draft" && event.ends_at <= Date.now())
              : false;
  if (!valid) throw new ApiError("INVALID_EVENT_ACTION", 409);
  const id = crypto.randomUUID(),
    now = Date.now();
  try {
    await env.DB.batch([
      ...(event.creator_id
        ? [
            env.DB.prepare(
              "INSERT INTO wallet_lock (user_id,operation_id) VALUES (?,?)",
            ).bind(event.creator_id, id),
          ]
        : []),
      env.DB.prepare(
        "INSERT INTO operation (id,event_id,action,phase,idempotency_key,status,created_at,updated_at,funding_quote_id,fee) VALUES (?,?,?,?,?,'pending',?,?,?,?)",
      ).bind(
        id,
        eventId,
        action,
        action === "launch" ? "create" : action,
        crypto.randomUUID(),
        now,
        now,
        quoteId,
        event.funding_fee,
      ),
      env.DB.prepare(
        "UPDATE event SET status = CASE WHEN ? = 'launch' THEN 'launching' ELSE status END WHERE id = ?",
      ).bind(action, eventId),
    ]);
  } catch (error) {
    if (
      (String(error) + String((error as { cause?: unknown }).cause)).includes(
        "QUOTE_EXPIRED",
      )
    )
      throw new ApiError("QUOTE_EXPIRED", 409);
    throw new ApiError("EVENT_OPERATION_PENDING", 409);
  }
  return (await env.DB.prepare("SELECT * FROM operation WHERE id = ?")
    .bind(id)
    .first<OperationRow>())!;
}
export async function reconcileOperation(env: Bindings, op: OperationRow) {
  if (op.status !== "pending") return;
  const event = (await env.DB.prepare("SELECT * FROM event WHERE id = ?")
    .bind(op.event_id)
    .first<EventRow>())!;
  const eventId = chainIdentifier(event.id);
  if (!op.transaction_id) {
    if (!event.creator_id || !event.funding_wallet_id || !event.funding_address)
      throw new ApiError("WALLET_UNAVAILABLE", 503);
    const quote = campaignFees(op.fee);
    const phases =
      op.action === "launch"
        ? launchPhases.slice(
            launchPhases.indexOf(op.phase as (typeof launchPhases)[number]),
          )
        : [op.phase];
    if (
      quote.action !== op.action ||
      !quote.fees[op.phase] ||
      phases.some((phase) => !quote.fees[phase])
    )
      throw new ApiError("QUOTE_EXPIRED", 409);
    const remainingFee = phases.reduce(
      (sum, phase) => sum + maximumFee(quote.fees[phase]),
      0n,
    );
    await sufficientBalance(
      env,
      event.funding_address,
      ["create", "approve", "fund"].includes(op.phase) ? event.budget : 0,
      remainingFee,
    );
    const call = await campaignTransaction(env, event, op.phase);
    const txId = await contractTransaction(
      env,
      call.signature,
      call.parameters,
      op.idempotency_key,
      call.address,
      event.funding_wallet_id,
      quote.fees[op.phase],
    );
    await env.DB.prepare(
      "UPDATE operation SET transaction_id = ?,updated_at = ? WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending'",
    )
      .bind(txId, Date.now(), op.id, op.phase, op.idempotency_key)
      .run();
    op = { ...op, transaction_id: txId };
  }
  const tx = (await circle(env).getTransaction({ id: op.transaction_id! })).data
    ?.transaction;
  if (!tx) return;
  let receipt = tx.txHash
    ? await rpc(env).getTransactionReceipt({ hash: tx.txHash as Hex })
    : null;
  if (
    (["FAILED", "DENIED", "CANCELLED"].includes(tx.state) &&
      receipt?.status !== "success") ||
    receipt?.status === "reverted"
  ) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE operation SET status = 'failed',error = ?,updated_at = ? WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending'",
      ).bind(
        `TRANSACTION_${tx.state}`,
        Date.now(),
        op.id,
        op.phase,
        op.idempotency_key,
      ),
      env.DB.prepare(
        "DELETE FROM wallet_lock WHERE operation_id = ? AND EXISTS (SELECT 1 FROM operation WHERE id = ? AND status = 'failed' AND idempotency_key = ?)",
      ).bind(op.id, op.id, op.idempotency_key),
    ]);
    return;
  }
  if (!receipt || receipt.status !== "success") return;
  if (
    tx.state !== "COMPLETE" &&
    !["FAILED", "DENIED", "CANCELLED"].includes(tx.state)
  )
    return;
  const abi = parseAbi([
    "event EventCreated(bytes32 indexed id,uint256 required)",
    "event Funded(bytes32 indexed id,uint256 amount)",
    "event Activated(bytes32 indexed id)",
    "event Paused(bytes32 indexed id,bool paused)",
    "event Closed(bytes32 indexed id)",
    "event Refunded(bytes32 indexed id,address recipient,uint256 amount)",
    "event Approval(address indexed owner,address indexed spender,uint256 value)",
  ]);
  const names: Record<string, string> = {
    create: "EventCreated",
    fund: "Funded",
    activate: "Activated",
    pause: "Paused",
    resume: "Paused",
    close: "Closed",
    refund: "Refunded",
    approve: "Approval",
  };
  const matches = receipt.logs.some((log) => {
    if (
      log.address.toLowerCase() !==
      (op.phase === "approve" ? USDC_ADDRESS : escrowAddress(env)).toLowerCase()
    )
      return false;
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== names[op.phase]) return false;
      if (decoded.eventName === "Approval")
        return (
          decoded.args.spender.toLowerCase() ===
            escrowAddress(env).toLowerCase() &&
          decoded.args.value === BigInt(event.budget) &&
          (!event.funding_address ||
            decoded.args.owner.toLowerCase() ===
              event.funding_address.toLowerCase())
        );
      if (decoded.args.id !== eventId) return false;
      if (decoded.eventName === "EventCreated")
        return decoded.args.required === BigInt(event.budget);
      if (decoded.eventName === "Funded")
        return decoded.args.amount === BigInt(event.budget);
      if (decoded.eventName === "Paused")
        return decoded.args.paused === (op.phase === "pause");
      if (decoded.eventName === "Refunded" && event.funding_address)
        return (
          decoded.args.recipient.toLowerCase() ===
          event.funding_address.toLowerCase()
        );
      return true;
    } catch {
      return false;
    }
  });
  if (!matches) throw new Error("Operation receipt does not match");
  const next =
    op.action === "launch"
      ? launchPhases[
          launchPhases.indexOf(op.phase as (typeof launchPhases)[number]) + 1
        ]
      : undefined;
  if (next) {
    await env.DB.prepare(
      "UPDATE operation SET phase = ?,transaction_id = NULL,idempotency_key = ?,updated_at = ? WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending'",
    )
      .bind(
        next,
        crypto.randomUUID(),
        Date.now(),
        op.id,
        op.phase,
        op.idempotency_key,
      )
      .run();
  } else {
    const status =
      op.action === "launch" || op.action === "resume"
        ? "active"
        : op.action === "pause"
          ? "paused"
          : "closed";
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM wallet_lock WHERE operation_id = ? AND EXISTS (SELECT 1 FROM operation WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending')",
      ).bind(op.id, op.id, op.phase, op.idempotency_key),
      env.DB.prepare(
        "UPDATE event SET status = ? WHERE id = ? AND EXISTS (SELECT 1 FROM operation WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending')",
      ).bind(status, event.id, op.id, op.phase, op.idempotency_key),
      env.DB.prepare(
        "UPDATE operation SET status = 'complete',updated_at = ? WHERE id = ? AND phase = ? AND idempotency_key = ? AND status = 'pending'",
      ).bind(Date.now(), op.id, op.phase, op.idempotency_key),
    ]);
  }
}
export async function reconcileOperations(env: Bindings) {
  const rows = await env.DB.prepare(
    "SELECT * FROM operation WHERE status = 'pending' ORDER BY updated_at LIMIT 10",
  ).all<OperationRow>();
  for (const op of rows.results)
    try {
      await reconcileOperation(env, op);
    } catch {
      console.error(
        JSON.stringify({
          event: "operation_reconciliation_failed",
          operationId: op.id,
        }),
      );
    }
}
