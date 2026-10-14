import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const hooks = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));
const requests = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("../lib/api", () => ({
  ...requests,
  RequestError: class extends Error {},
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useState: (value: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [value, setter];
  },
}));
import { WalletActions } from "./WalletActions";
import { Spinner } from "./Spinner";
beforeEach(() => {
  hooks.effects = [];
  hooks.setters = [];
  requests.post.mockReset();
  requests.api.mockReset();
});
it("opens Receive using the provisioned address without requesting a balance or send history", async () => {
  const address = "0x2222222222222222222222222222222222222222";
  requests.post.mockResolvedValue({ wallet: { address } });
  WalletActions({ action: "receive", signedIn: true, requestSignIn: vi.fn() });
  hooks.effects[0]();
  await vi.waitFor(() =>
    expect(hooks.setters[0]).toHaveBeenCalledWith(address),
  );
  expect(requests.post).toHaveBeenCalledWith("/wallet");
  expect(requests.api).not.toHaveBeenCalled();
});
it("renders accessible visual loading without visible loading copy", () => {
  const html = renderToStaticMarkup(<Spinner label="Opening wallet" full />);
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-label="Opening wallet"');
  expect(html).toContain("loading-spinner");
  expect(html).not.toContain("Loading…");
});
