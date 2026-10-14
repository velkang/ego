import { expect, it } from "vitest";
import { encryptProof, decryptProof, proofHash } from "../src/proofs";
import type { Bindings } from "../src/env";
const env = { PROOF_SECRET: "a-long-secret" } as Bindings;
it("encrypts secrets with a random IV and authenticates the drop identifier", async () => {
  const a = await encryptProof(env, "private answer", "drop-a"),
    b = await encryptProof(env, "private answer", "drop-a");
  expect(a).not.toBe(b);
  expect(a).not.toContain("private answer");
  expect(await decryptProof(env, a, "drop-a")).toBe("private answer");
  await expect(decryptProof(env, a, "drop-b")).rejects.toThrow();
  await expect(
    decryptProof({ ...env, PROOF_SECRET: "different" }, a, "drop-a"),
  ).rejects.toThrow();
});
it("normalizes whitespace and Unicode while keeping hashes keyed", async () => {
  expect(await proofHash(env, " ＢＬＵＥ  moon ")).toBe(
    await proofHash(env, "blue moon"),
  );
  expect(
    await proofHash({ ...env, PROOF_SECRET: "other" }, "blue moon"),
  ).not.toBe(await proofHash(env, "blue moon"));
});
