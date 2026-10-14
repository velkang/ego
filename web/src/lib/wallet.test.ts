import { afterEach, beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: request }));
import { invalidateWallet, readWallet } from "./wallet";

const snapshot = {
  wallet: { address: "0x2222222222222222222222222222222222222222" },
  balance: "1", balanceUnits: "1000000", claims: [],
};
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  invalidateWallet();
  request.mockReset();
  request.mockResolvedValue(snapshot);
});

it("shares in-flight reads and reuses the snapshot across navigation without timers", async () => {
  let finish!: (value: unknown) => void;
  request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const first = readWallet("alice");
  expect(readWallet("alice")).toBe(first);
  expect(request).toHaveBeenCalledTimes(1);
  finish(snapshot);
  await first;
  expect(await readWallet("alice")).toBe(snapshot);
  expect(request).toHaveBeenCalledTimes(1);
});

it("reads again only for explicit refresh, invalidation, or a different account", async () => {
  await readWallet("alice");
  await readWallet("alice", true);
  expect(request).toHaveBeenCalledTimes(2);
  invalidateWallet();
  await readWallet("alice");
  await readWallet("bob");
  expect(request).toHaveBeenCalledTimes(4);
});

it("does not cache failed or unavailable balances", async () => {
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(readWallet("alice")).rejects.toThrow("offline");
  request.mockResolvedValueOnce({ ...snapshot, balance: null });
  await readWallet("alice");
  expect(await readWallet("alice")).toBe(snapshot);
  expect(request).toHaveBeenCalledTimes(3);
});

it("an old in-flight response cannot overwrite an invalidated snapshot", async () => {
  let finish!: (value: unknown) => void;
  request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const old = readWallet("alice");
  invalidateWallet();
  const fresh = { ...snapshot, balance: "2" };
  request.mockResolvedValueOnce(fresh);
  await readWallet("alice");
  finish(snapshot);
  await old;
  expect(await readWallet("alice")).toBe(fresh);
});

it("reuses reads for 15 seconds and refreshes once the snapshot is stale", async () => {
  vi.useFakeTimers();
  await readWallet("alice");
  vi.advanceTimersByTime(14_999);
  await readWallet("alice");
  expect(request).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await readWallet("alice");
  expect(request).toHaveBeenCalledTimes(2);
});
