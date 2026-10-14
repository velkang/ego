import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import * as circle from "../src/circle";
import type { Bindings } from "../src/env";

afterEach(() => vi.restoreAllMocks());

it("acknowledges unsigned probes without processing any body", async () => {
  const prepare = vi.fn(() => {
    throw new Error("Unsigned request touched D1");
  });
  const env = { DB: { prepare } } as unknown as Bindings;
  for (const body of [
    "",
    "{}",
    JSON.stringify({ notification: { id: crypto.randomUUID() } }),
  ]) {
    const response = await createApp().request(
      "/v1/webhooks/circle",
      { method: "POST", body },
      env,
    );
    expect(response.status).toBe(204);
  }
  expect(prepare).not.toHaveBeenCalled();
});

it("rejects invalid and partial signatures before database access", async () => {
  const verify = vi.spyOn(circle, "verifyCircleWebhook").mockResolvedValue(false);
  const prepare = vi.fn();
  const env = { DB: { prepare } } as unknown as Bindings;
  const cases: Record<string, string>[] = [
    { "X-Circle-Signature": "invalid" },
    { "X-Circle-Key-Id": crypto.randomUUID() },
    { "X-Circle-Signature": "invalid", "X-Circle-Key-Id": crypto.randomUUID() },
  ];
  for (const headers of cases) {
    const response = await createApp().request(
      "/v1/webhooks/circle",
      { method: "POST", headers, body: "{}" },
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(verify).toHaveBeenCalledTimes(3);
  expect(prepare).not.toHaveBeenCalled();
});

it("requires the configured subscription for signed notifications", async () => {
  vi.spyOn(circle, "verifyCircleWebhook").mockResolvedValue(true);
  const prepare = vi.fn();
  const env = {
    DB: { prepare },
    CIRCLE_WEBHOOK_SUBSCRIPTION_ID: crypto.randomUUID(),
  } as unknown as Bindings;
  const response = await createApp().request(
    "/v1/webhooks/circle",
    {
      method: "POST",
      headers: {
        "X-Circle-Signature": "signed",
        "X-Circle-Key-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        notificationId: crypto.randomUUID(),
        subscriptionId: crypto.randomUUID(),
        version: 2,
        notification: { id: crypto.randomUUID() },
      }),
    },
    env,
  );
  expect(response.status).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
});
