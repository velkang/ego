import {
  chainIdentifier,
  locationError,
  type LocationEvidence,
} from "@jovva/chain";
import type { Hex } from "viem";
import type { Bindings } from "./env";
import type { ClaimRow, EventRow, SpotRow } from "./db";
import { ApiError } from "./http";
import {
  accountHash,
  circle,
  contractTransaction,
  ensureWallet,
  escrowAddress,
  payoutConfirmed,
  rpc,
} from "./circle";
export function publicClaim(row: ClaimRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    spotId: row.spot_id,
    amount: row.amount,
    status: row.status,
    transactionHash: row.transaction_hash,
    error: row.error,
    createdAt: row.created_at,
  };
}
export async function reserveClaim(
  env: Bindings,
  userId: string,
  spotId: string,
  location: LocationEvidence,
) {
  const spot = await env.DB.prepare("SELECT * FROM spot WHERE id = ?")
    .bind(spotId)
    .first<SpotRow>();
  if (!spot) throw new ApiError("SPOT_NOT_FOUND", 404);
  const existing = await env.DB.prepare(
    "SELECT * FROM claim WHERE user_id = ? AND event_id = ? AND status != 'failed'",
  )
    .bind(userId, spot.event_id)
    .first<ClaimRow>();
  if (existing) return existing;
  const event = await env.DB.prepare("SELECT * FROM event WHERE id = ?")
    .bind(spot.event_id)
    .first<EventRow>();
  const now = Date.now();
  if (!event || now >= event.ends_at) throw new ApiError("EVENT_EXPIRED", 409);
  if (event.status !== "active" || now < event.starts_at)
    throw new ApiError("EVENT_UNAVAILABLE", 409);
  const error = locationError(location, spot, now);
  if (error) throw new ApiError(error);
  if (spot.remaining <= 0) throw new ApiError("SPOT_EXHAUSTED", 409);
  const wallet = await ensureWallet(env, userId);
  const hash = await accountHash(env, userId);
  // Obtain a new server timestamp after the asynchronous wallet request, then recheck freshness.
  const createdAt = Date.now();
  const refreshedError = locationError(location, spot, createdAt);
  if (refreshedError) throw new ApiError(refreshedError);
  const id = crypto.randomUUID(),
    key = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE spot SET remaining = remaining - 1 WHERE id = ?",
      ).bind(spotId),
      env.DB.prepare(
        "INSERT INTO claim (id,user_id,event_id,spot_id,account_hash,recipient,amount,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'reserved',?,?)",
      ).bind(
        id,
        userId,
        event.id,
        spotId,
        hash,
        wallet.address,
        spot.amount,
        key,
        createdAt,
        createdAt,
      ),
    ]);
  } catch {
    const winner = await env.DB.prepare(
      "SELECT * FROM claim WHERE user_id = ? AND event_id = ? AND status != 'failed'",
    )
      .bind(userId, event.id)
      .first<ClaimRow>();
    if (winner) return winner;
    throw new ApiError("SPOT_UNAVAILABLE", 409);
  }
  return (await env.DB.prepare("SELECT * FROM claim WHERE id = ?")
    .bind(id)
    .first<ClaimRow>())!;
}
export async function failClaim(db: D1Database, id: string, error: string) {
  await db.batch([
    db
      .prepare(
        "UPDATE spot SET remaining = remaining + 1 WHERE id = (SELECT spot_id FROM claim WHERE id = ? AND status IN ('reserved','submitted'))",
      )
      .bind(id),
    db
      .prepare(
        "UPDATE claim SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status IN ('reserved','submitted')",
      )
      .bind(error, Date.now(), id),
  ]);
}
export async function reconcileClaim(env: Bindings, claim: ClaimRow) {
  if (claim.status === "confirmed" || claim.status === "failed") return;
  if (!claim.transaction_id) {
    // Never release on a transport error: Circle may have accepted the request.
    const id = await contractTransaction(
      env,
      "claim(bytes32,bytes32,bytes32,address)",
      [
        chainIdentifier(claim.event_id),
        chainIdentifier(claim.spot_id),
        claim.account_hash,
        claim.recipient,
      ],
      claim.idempotency_key,
    );
    await env.DB.prepare(
      "UPDATE claim SET transaction_id = ?, status = 'submitted', updated_at = ? WHERE id = ? AND status = 'reserved'",
    )
      .bind(id, Date.now(), claim.id)
      .run();
    claim = { ...claim, transaction_id: id, status: "submitted" };
  }
  const response = await circle(env).getTransaction({
    id: claim.transaction_id!,
  });
  const tx = response.data?.transaction;
  if (!tx) return;
  if (tx.state === "COMPLETE" && tx.txHash) {
    if (!(await payoutConfirmed(env, claim, tx.txHash as Hex)))
      throw new Error("Payout receipt does not match claim");
    const updated = await env.DB.prepare(
      "UPDATE claim SET status = 'confirmed',transaction_hash = ?,error = NULL,updated_at = ? WHERE id = ? AND status = 'submitted'",
    )
      .bind(tx.txHash, Date.now(), claim.id)
      .run();
    if (updated.meta.changes)
      console.info(
        JSON.stringify({
          event: "claim_confirmed",
          claimId: claim.id,
          latencyMs: Date.now() - claim.created_at,
        }),
      );
  } else if (["FAILED", "CANCELLED", "DENIED"].includes(tx.state)) {
    const paid = await rpc(env).readContract({
      address: escrowAddress(env),
      abi: [
        {
          type: "function",
          name: "hasClaimed",
          stateMutability: "view",
          inputs: [
            { type: "bytes32", name: "eventId" },
            { type: "bytes32", name: "accountId" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "hasClaimed",
      args: [chainIdentifier(claim.event_id), claim.account_hash as Hex],
    });
    if (!paid) await failClaim(env.DB, claim.id, `PAYOUT_${tx.state}`);
    // If already paid, retain the reservation for manual receipt reconciliation.
  }
}
export async function reconcileClaims(env: Bindings) {
  const rows = await env.DB.prepare(
    "SELECT * FROM claim WHERE status IN ('reserved','submitted') ORDER BY updated_at LIMIT 20",
  ).all<ClaimRow>();
  for (const row of rows.results)
    try {
      await reconcileClaim(env, row);
    } catch {
      console.error(
        JSON.stringify({
          event: "claim_reconciliation_failed",
          claimId: row.id,
        }),
      );
    }
}
