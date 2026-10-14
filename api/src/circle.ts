import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicKey, verify } from "node:crypto";
import {
  createPublicClient,
  http,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { arc, egoDropsAbi, chainIdentifier } from "@ego/chain";
import type { Bindings } from "./env";
import { ApiError, requireConfig } from "./http";
import type { AbsoluteFee } from "./spends";
import type { ClaimRow } from "./db";
export function circle(env: Bindings) {
  return initiateDeveloperControlledWalletsClient({
    apiKey: requireConfig(env.CIRCLE_API_KEY, "CIRCLE"),
    entitySecret: requireConfig(
      env.CIRCLE_ENTITY_SECRET,
      "CIRCLE_ENTITY_SECRET",
    ),
  });
}
export const rpc = (env: Bindings) =>
  createPublicClient({
    chain: arc,
    transport: http(env.ARC_RPC_URL || arc.rpcUrls.default.http[0], {
      timeout: 10000,
      retryCount: 1,
    }),
  });
export function escrowAddress(env: Bindings): Address {
  const value = requireConfig(env.EGO_DROPS_ADDRESS, "ESCROW");
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new ApiError("INVALID_ESCROW_CONFIGURATION", 503);
  return value as Address;
}
export async function ensureWallet(env: Bindings, userId: string) {
  requireConfig(env.CIRCLE_WALLET_SET_ID, "WALLET_SET");
  await env.DB.prepare(
    "INSERT INTO wallet (user_id,idempotency_key,created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING",
  )
    .bind(userId, crypto.randomUUID(), Date.now())
    .run();
  const row = await env.DB.prepare("SELECT * FROM wallet WHERE user_id = ?")
    .bind(userId)
    .first<{
      user_id: string;
      idempotency_key: string;
      wallet_id: string | null;
      address: string | null;
    }>();
  if (!row) throw new ApiError("WALLET_UNAVAILABLE", 503);
  if (row.wallet_id && row.address)
    return { id: row.wallet_id, address: row.address };
  const response = await circle(env).createWallets({
    walletSetId: env.CIRCLE_WALLET_SET_ID,
    blockchains: ["ARC"],
    accountType: "EOA",
    count: 1,
    metadata: [{ refId: userId }],
    idempotencyKey: row.idempotency_key,
  });
  const created = response.data?.wallets?.[0];
  if (!created?.id || !created.address)
    throw new ApiError("WALLET_UNAVAILABLE", 503);
  await env.DB.prepare(
    "UPDATE wallet SET wallet_id = ?, address = ? WHERE user_id = ? AND wallet_id IS NULL",
  )
    .bind(created.id, created.address, userId)
    .run();
  return { id: created.id, address: created.address };
}
export async function contractTransaction(
  env: Bindings,
  signature: string,
  parameters: unknown[],
  key: string,
  address = escrowAddress(env),
  walletId = requireConfig(env.CIRCLE_OPERATOR_WALLET_ID, "OPERATOR_WALLET"),
  fee?: AbsoluteFee,
) {
  const response = await circle(env).createContractExecutionTransaction({
    walletId,
    contractAddress: address,
    abiFunctionSignature: signature,
    abiParameters: parameters,
    idempotencyKey: key,
    fee: fee ?? { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  if (!response.data?.id) throw new ApiError("TRANSACTION_UNAVAILABLE", 503);
  return response.data.id;
}
export async function accountHash(env: Bindings, userId: string): Promise<Hex> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(
      requireConfig(env.ACCOUNT_HASH_SECRET, "ACCOUNT_HASH_SECRET"),
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId)),
  );
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function payoutConfirmed(
  env: Bindings,
  claim: ClaimRow,
  hash: Hex,
) {
  const receipt = await rpc(env).getTransactionReceipt({ hash });
  if (receipt.status !== "success") return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress(env).toLowerCase())
      return false;
    try {
      const decoded = decodeEventLog({
        abi: egoDropsAbi,
        data: log.data,
        topics: log.topics,
      });
      return (
        decoded.eventName === "Claimed" &&
        decoded.args.eventId === chainIdentifier(claim.event_id) &&
        decoded.args.spotId === chainIdentifier(claim.spot_id) &&
        decoded.args.accountId === claim.account_hash &&
        decoded.args.recipient.toLowerCase() ===
          claim.recipient.toLowerCase() &&
        decoded.args.amount === BigInt(claim.amount)
      );
    } catch {
      return false;
    }
  });
}
const webhookKeys = new Map<string, ReturnType<typeof createPublicKey>>();
export async function verifyCircleWebhook(
  env: Bindings,
  rawBody: string,
  signature: string,
  keyId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(keyId) || !signature || rawBody.length > 131072)
    return false;
  let key = webhookKeys.get(keyId);
  if (!key) {
    const response = await fetch(
      `https://api.circle.com/v2/notifications/publicKey/${keyId}`,
      {
        headers: {
          Authorization: `Bearer ${requireConfig(env.CIRCLE_API_KEY, "CIRCLE")}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      data?: { algorithm: string; publicKey: string };
    };
    if (body.data?.algorithm !== "ECDSA_SHA_256") return false;
    key = createPublicKey({
      key: Buffer.from(body.data.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (webhookKeys.size >= 20) webhookKeys.clear();
    webhookKeys.set(keyId, key);
  }
  return verify(
    "sha256",
    Buffer.from(rawBody),
    key,
    Buffer.from(signature, "base64"),
  );
}
