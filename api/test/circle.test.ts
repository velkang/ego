import { beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { d1 } from "./d1";
import type { Bindings } from "../src/env";
const sdk = vi.hoisted(() => ({ createWallets: vi.fn() }));
vi.mock("@circle-fin/developer-controlled-wallets", () => ({
  initiateDeveloperControlledWalletsClient: () => sdk,
}));
import { ensureWallet } from "../src/circle";
let sql: DatabaseSync, env: Bindings;
beforeEach(() => {
  sdk.createWallets.mockReset();
  sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  sql
    .prepare("INSERT INTO user VALUES (?,?,?,1,NULL,?,?)")
    .run("user", "User", "user@example.com", Date.now(), Date.now());
  env = {
    DB: d1(sql),
    CIRCLE_WALLET_SET_ID: "set",
    CIRCLE_API_KEY: "key",
    CIRCLE_ENTITY_SECRET: "secret",
  } as Bindings;
});
it("reuses a persisted creation key after an interrupted Circle request", async () => {
  sdk.createWallets
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce({
      data: {
        wallets: [
          {
            id: "wallet",
            address: "0x2222222222222222222222222222222222222222",
          },
        ],
      },
    });
  await expect(ensureWallet(env, "user")).rejects.toThrow("response lost");
  const wallet = await ensureWallet(env, "user");
  expect(wallet.id).toBe("wallet");
  expect(sdk.createWallets.mock.calls[0][0].idempotencyKey).toBe(
    sdk.createWallets.mock.calls[1][0].idempotencyKey,
  );
  await ensureWallet(env, "user");
  expect(sdk.createWallets).toHaveBeenCalledTimes(2);
  expect(sdk.createWallets.mock.calls[0][0]).toMatchObject({
    accountType: "EOA",
    blockchains: ["ARC"],
  });
  sql.close();
});
