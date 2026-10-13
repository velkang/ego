import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate } from "./router";
afterEach(() => vi.unstubAllGlobals());
describe("navigation", () => {
  it("replaces legacy URLs without adding another history entry", () => {
    const pushState = vi.fn(),
      replaceState = vi.fn(),
      dispatchEvent = vi.fn();
    vi.stubGlobal("history", { pushState, replaceState });
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "PopStateEvent",
      class {
        constructor(public type: string) {}
      },
    );
    navigate("/events/garden-gathering", true);
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/events/garden-gathering",
    );
    expect(pushState).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
  it("rejects external URLs", () => {
    const pushState = vi.fn();
    vi.stubGlobal("history", { pushState });
    navigate("//example.com");
    navigate("https://example.com");
    expect(pushState).not.toHaveBeenCalled();
  });
});
