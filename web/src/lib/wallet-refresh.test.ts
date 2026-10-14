import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchWallet } from "./wallet-refresh";

let page: EventTarget & { visibilityState: string };
let browser: EventTarget;
let network: { onLine: boolean };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browser = new EventTarget();
  network = { onLine: true };
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("navigator", network);
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("checks every 30 seconds while visible and stops on hide, offline, or cleanup", async () => {
  const refresh = vi.fn().mockResolvedValue(true);
  stop = watchWallet(refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  network.onLine = false;
  browser.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  network.onLine = true;
  browser.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(3);
  stop();
  browser.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("does not overlap slow requests or restart after cleanup during a request", async () => {
  let finish!: (success: boolean) => void;
  const refresh = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  stop = watchWallet(refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  browser.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  finish(true);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("backs off after failure, including focus events, and returns to normal after recovery", async () => {
  const refresh = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  stop = watchWallet(refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  browser.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(59_999);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(3);
});
