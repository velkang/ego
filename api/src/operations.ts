import { chainIdentifier, USDC_ADDRESS } from "@jovva/chain";
import { circle, contractTransaction, escrowAddress, rpc } from "./circle";
import type { Bindings } from "./env";
import type { EventRow, OperationRow, SpotRow } from "./db";
import type { Hex } from "viem";
import { ApiError } from "./http";
const launchPhases = ["create", "approve", "fund", "activate"];
export async function startOperation(
  env: Bindings,
  eventId: string,
  action: string,
) {
  const event = await env.DB.prepare("SELECT * FROM event WHERE id = ?")
    .bind(eventId)
    .first<EventRow>();
  if (!event) throw new ApiError("EVENT_NOT_FOUND", 404);
  const existing = await env.DB.prepare(
    "SELECT * FROM operation WHERE event_id = ? AND status = 'pending'",
  )
    .bind(eventId)
    .first<OperationRow>();
  if (existing) return existing;
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
      env.DB.prepare(
        "INSERT INTO operation (id,event_id,action,phase,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)",
      ).bind(
        id,
        eventId,
        action,
        action === "launch" ? "create" : action,
        crypto.randomUUID(),
        now,
        now,
      ),
      env.DB.prepare(
        "UPDATE event SET status = CASE WHEN ? = 'launch' THEN 'launching' ELSE status END WHERE id = ?",
      ).bind(action, eventId),
    ]);
  } catch {
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
    let signature: string,
      args: unknown[],
      address = escrowAddress(env);
    if (op.phase === "create") {
      const spots = (
        await env.DB.prepare(
          "SELECT * FROM spot WHERE event_id = ? ORDER BY id",
        )
          .bind(event.id)
          .all<SpotRow>()
      ).results;
      signature =
        "createEvent(bytes32,uint64,uint64,bytes32[],uint256[],uint32[])";
      args = [
        eventId,
        String(Math.floor(event.starts_at / 1000)),
        String(Math.floor(event.ends_at / 1000)),
        spots.map((s) => chainIdentifier(s.id)),
        spots.map((s) => String(s.amount)),
        spots.map((s) => String(s.capacity)),
      ];
    } else if (op.phase === "approve") {
      signature = "approve(address,uint256)";
      args = [address, String(event.budget)];
      address = USDC_ADDRESS;
    } else if (op.phase === "fund") {
      signature = "fund(bytes32,uint256)";
      args = [eventId, String(event.budget)];
    } else if (op.phase === "pause" || op.phase === "resume") {
      signature = "setPaused(bytes32,bool)";
      args = [eventId, op.phase === "pause"];
    } else {
      signature = `${op.phase}(bytes32)`;
      args = [eventId];
    }
    const txId = await contractTransaction(
      env,
      signature,
      args,
      op.idempotency_key,
      address,
    );
    await env.DB.prepare(
      "UPDATE operation SET transaction_id = ?,updated_at = ? WHERE id = ? AND phase = ? AND status = 'pending'",
    )
      .bind(txId, Date.now(), op.id, op.phase)
      .run();
    op = { ...op, transaction_id: txId };
  }
  const tx = (await circle(env).getTransaction({ id: op.transaction_id! })).data
    ?.transaction;
  if (!tx) return;
  if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
    await env.DB.prepare(
      "UPDATE operation SET status = 'failed',error = ?,updated_at = ? WHERE id = ? AND phase = ? AND status = 'pending'",
    )
      .bind(`TRANSACTION_${tx.state}`, Date.now(), op.id, op.phase)
      .run();
    return;
  }
  if (tx.state !== "COMPLETE" || !tx.txHash) return;
  const receipt = await rpc(env).getTransactionReceipt({
    hash: tx.txHash as Hex,
  });
  if (receipt.status !== "success") throw new Error("Operation receipt failed");
  const next =
    op.action === "launch"
      ? launchPhases[launchPhases.indexOf(op.phase) + 1]
      : undefined;
  if (next) {
    await env.DB.prepare(
      "UPDATE operation SET phase = ?,transaction_id = NULL,idempotency_key = ?,updated_at = ? WHERE id = ? AND phase = ? AND status = 'pending'",
    )
      .bind(next, crypto.randomUUID(), Date.now(), op.id, op.phase)
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
        "UPDATE event SET status = ? WHERE id = ? AND EXISTS (SELECT 1 FROM operation WHERE id = ? AND phase = ? AND status = 'pending')",
      ).bind(status, event.id, op.id, op.phase),
      env.DB.prepare(
        "UPDATE operation SET status = 'complete',updated_at = ? WHERE id = ? AND phase = ? AND status = 'pending'",
      ).bind(Date.now(), op.id, op.phase),
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
