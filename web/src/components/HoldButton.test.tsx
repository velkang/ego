import { beforeEach, afterEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { HoldButton } from "./HoldButton";
let frames: FrameRequestCallback[], listeners: Record<string, () => void>;
beforeEach(() => {
  frames = [];
  listeners = {};
  hooks.effects = [];
  vi.stubGlobal("performance", { now: () => 0 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const events = {
    addEventListener: (name: string, callback: () => void) => {
      listeners[name] = callback;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", events);
  vi.stubGlobal("document", events);
});
afterEach(() => vi.unstubAllGlobals());
it("requires an uninterrupted hold and cancels on release or loss of foreground", () => {
  const claim = vi.fn(),
    button = HoldButton({ onComplete: claim, children: "Hold" }),
    props = button.props as any;
  hooks.effects.forEach((effect) => effect());
  props.onPointerDown({
    button: 0,
    pointerId: 1,
    currentTarget: { setPointerCapture() {} },
  });
  frames.shift()!(1000);
  expect(claim).not.toHaveBeenCalled();
  props.onPointerUp();
  frames.shift()!(1200);
  expect(claim).not.toHaveBeenCalled();
  props.onKeyDown({ key: " ", repeat: false, preventDefault() {} });
  listeners.visibilitychange();
  frames.shift()!(1200);
  expect(claim).not.toHaveBeenCalled();
  props.onKeyDown({ key: "Enter", repeat: false, preventDefault() {} });
  frames.shift()!(1200);
  expect(claim).toHaveBeenCalledTimes(1);
});
it("supports assistive click activation without double-submitting a pointer click", () => {
  const claim = vi.fn(),
    props = HoldButton({ onComplete: claim, children: "Hold" }).props as any;
  props.onClick({ detail: 1 });
  expect(claim).not.toHaveBeenCalled();
  props.onClick({ detail: 0 });
  expect(claim).toHaveBeenCalledTimes(1);
  const busy = HoldButton({ onComplete: claim, children: "Hold", busy: true })
    .props as any;
  busy.onClick({ detail: 0 });
  expect(claim).toHaveBeenCalledTimes(1);
});
