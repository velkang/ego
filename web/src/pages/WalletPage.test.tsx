import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const hooks = vi.hoisted(() => ({
  data: null as unknown,
  index: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => unknown)[],
}));
const requests = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("../lib/api", () => requests);
vi.mock("../components/Coin", () => ({ Coin: () => null, LargeCoin: () => null }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useState: (value: unknown) => {
    const index = hooks.index++;
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [index === 0 ? hooks.data : value, setter];
  },
}));
import { WalletPage } from "./WalletPage";

const address = "0x2222222222222222222222222222222222222222";
beforeEach(() => {
  hooks.data = null;
  hooks.index = 0;
  hooks.setters = [];
  hooks.effects = [];
  requests.api.mockReset();
  requests.post.mockReset();
});

it("shows the wallet and collection without inventing a zero balance on RPC failure", () => {
  hooks.data = {
    wallet: { address }, balance: null, balanceUnits: null,
    balanceError: "BALANCE_UNAVAILABLE",
    claims: [{ id: "claim", amount: 1000000, status: "confirmed", createdAt: 1 }],
  };
  const html = renderToStaticMarkup(WalletPage({ signedIn: true, requestSignIn: vi.fn() }));
  expect(html).toContain("Balance unavailable. Try refreshing.");
  expect(html).toContain("0x2222…2222");
  expect(html).toContain('href="/wallet/receive"');
  expect(html).toContain('class="claim-card"');
  expect(html).not.toContain('class="dec">.00');
});

it("publishes the created wallet before the first balance request finishes", async () => {
  let finishBalance!: (value: unknown) => void;
  const firstBalance = new Promise((resolve) => { finishBalance = resolve; });
  requests.api.mockResolvedValueOnce({ wallet: null, balance: "0", claims: [] })
    .mockReturnValueOnce(firstBalance);
  requests.post.mockResolvedValue({ wallet: { address } });
  WalletPage({ signedIn: true, requestSignIn: vi.fn() });
  hooks.effects[0]();
  await vi.waitFor(() => expect(requests.api).toHaveBeenCalledTimes(2));
  expect(hooks.setters[0]).toHaveBeenCalledWith({
    wallet: { address }, balance: null, balanceUnits: null, balanceError: null, claims: [],
  });
  expect(requests.post).toHaveBeenCalledTimes(1);
  const unavailable = {
    wallet: { address }, balance: null, balanceUnits: null,
    balanceError: "BALANCE_UNAVAILABLE", claims: [],
  };
  finishBalance(unavailable);
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenLastCalledWith(unavailable));
  expect(hooks.setters[1]).not.toHaveBeenCalledWith(expect.stringContaining("unavailable"));
});
