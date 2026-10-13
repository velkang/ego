import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  setters: [] as ReturnType<typeof vi.fn>[],
  refs: 0,
}));
const maps = vi.hoisted(() => ({
  instances: [] as {
    handlers: Record<string, () => void>;
    remove: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    hooks.effects.push(effect);
  },
  useRef: (value: unknown) => ({
    current:
      hooks.refs++ === 0
        ? { clientHeight: 844, querySelectorAll: () => [] }
        : value,
  }),
  useState: (value: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [value, setter];
  },
}));
vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {
      handlers: Record<string, () => void> = {};
      remove = vi.fn();
      constructor() {
        maps.instances.push(this);
      }
      addControl() {}
      once(name: string, callback: () => void) {
        this.handlers[name] = callback;
      }
      resize() {}
    },
    LngLatBounds: class {},
    NavigationControl: class {},
  },
}));
import { EventMap } from "./EventMap";
beforeEach(() => {
  hooks.effects = [];
  hooks.setters = [];
  hooks.refs = 0;
  maps.instances = [];
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("map lifecycle", () => {
  it("loads a real style without a key and releases the map on navigation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ version: 8, sources: {}, layers: [] }),
      });
    vi.stubGlobal("fetch", fetcher);
    EventMap({ position: null });
    const cleanup = hooks.effects[0]() as () => void;
    await vi.waitFor(() => expect(maps.instances).toHaveLength(1));
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://tiles.openfreemap.org/styles/positron",
    );
    maps.instances[0].handlers.load();
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(false);
    cleanup();
    expect(maps.instances[0].remove).toHaveBeenCalledOnce();
  });
  it("reports a style failure and leaves the list route usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    EventMap({ position: null });
    const cleanup = hooks.effects[0]() as () => void;
    await vi.waitFor(() =>
      expect(hooks.setters[0]).toHaveBeenLastCalledWith(true),
    );
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(false);
    expect(maps.instances).toHaveLength(0);
    cleanup();
  });
  it("aborts an interrupted load without updating an unmounted surface", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    );
    EventMap({ position: null });
    const cleanup = hooks.effects[0]() as () => void;
    cleanup();
    expect(signal?.aborted).toBe(true);
    expect(hooks.setters[0]).not.toHaveBeenCalledWith(true);
  });
});
