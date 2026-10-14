import type { Bindings } from "./env";
import { requireConfig } from "./http";
const bytes = new TextEncoder();
export const normalizeProof = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
async function key(env: Bindings) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.encode(requireConfig(env.PROOF_SECRET, "PROOF_SECRET")),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function proofHash(env: Bindings, value: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    bytes.encode(requireConfig(env.PROOF_SECRET, "PROOF_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", k, bytes.encode(normalizeProof(value))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function encryptProof(
  env: Bindings,
  value: string,
  spotId: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: bytes.encode(spotId) },
      await key(env),
      bytes.encode(value),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...ciphertext));
}
export async function decryptProof(
  env: Bindings,
  value: string,
  spotId: string,
) {
  const data = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: data.slice(0, 12),
        additionalData: bytes.encode(spotId),
      },
      await key(env),
      data.slice(12),
    ),
  );
}
