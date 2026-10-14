import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  effects: [] as (() => () => void)[],
  dialog: null as any,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => ({ current: hooks.dialog }),
  useEffect: (effect: () => () => void) => hooks.effects.push(effect),
}));
import { WalletDrawer } from "./WalletDrawer";
let scroll: { style: { overflow: string } },
  previous: { focus: ReturnType<typeof vi.fn> };
beforeEach(() => {
  hooks.effects = [];
  hooks.dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
  scroll = { style: { overflow: "auto" } };
  class Element {
    isConnected = true;
    focus = vi.fn();
  }
  previous = new Element();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", {
    activeElement: previous,
    querySelector: () => scroll,
  });
});
afterEach(() => vi.unstubAllGlobals());
const props = {
  action: "send" as const,
  accountId: "user",
  signedIn: true,
  requestSignIn: vi.fn(),
};
it("opens a native modal, locks background scrolling, and restores focus on close", () => {
  const result = WalletDrawer({ ...props, onClose: vi.fn() });
  expect(result.type).toBe("dialog");
  expect(result.props["aria-labelledby"]).toBe("wallet-drawer-title");
  const cleanup = hooks.effects[0]();
  expect(hooks.dialog.showModal).toHaveBeenCalledOnce();
  expect(scroll.style.overflow).toBe("hidden");
  cleanup();
  expect(hooks.dialog.close).toHaveBeenCalledOnce();
  expect(scroll.style.overflow).toBe("auto");
  expect(previous.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it("handles Escape and backdrop clicks without dismissing clicks inside the sheet", () => {
  const onClose = vi.fn();
  const result = WalletDrawer({ ...props, onClose });
  const cancel = { preventDefault: vi.fn() };
  result.props.onCancel(cancel);
  expect(cancel.preventDefault).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  const dialog = {
    getBoundingClientRect: () => ({
      left: 0,
      right: 390,
      top: 400,
      bottom: 844,
    }),
  };
  result.props.onClick({
    target: dialog,
    currentTarget: dialog,
    clientX: 30,
    clientY: 600,
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  result.props.onClick({
    target: dialog,
    currentTarget: dialog,
    clientX: 30,
    clientY: 200,
  });
  expect(onClose).toHaveBeenCalledTimes(2);
});
