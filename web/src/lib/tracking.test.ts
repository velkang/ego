import { afterEach, describe, expect, it, vi } from "vitest";
import { trackLocation } from "./location";
afterEach(() => vi.unstubAllGlobals());
describe("foreground hunt tracking", () => {
  it("pauses in the background, resumes, and ignores callbacks after closure", () => {
    let visibility = () => {};
    const doc = {
      hidden: false,
      addEventListener: vi.fn((_name: string, callback: () => void) => {
        visibility = callback;
      }),
      removeEventListener: vi.fn(),
    };
    let success: PositionCallback = () => {};
    const watchPosition = vi.fn((callback: PositionCallback): number => {
      success = callback;
      return watchPosition.mock.calls.length;
    });
    const clearWatch = vi.fn(),
      onPosition = vi.fn();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const close = trackLocation(onPosition, vi.fn());
    expect(watchPosition).toHaveBeenCalledOnce();
    doc.hidden = true;
    visibility();
    expect(clearWatch).toHaveBeenCalledWith(1);
    doc.hidden = false;
    visibility();
    expect(watchPosition).toHaveBeenCalledTimes(2);
    close();
    expect(clearWatch).toHaveBeenCalledWith(2);
    expect(doc.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      visibility,
    );
    success({
      coords: { latitude: 0, longitude: 0, accuracy: 10 },
      timestamp: Date.now(),
    } as GeolocationPosition);
    expect(onPosition).not.toHaveBeenCalled();
    visibility();
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });
  it("reports location denial without enabling a claim", () => {
    const onError = vi.fn(),
      onPosition = vi.fn();
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) => {
          error({ code: 1 } as GeolocationPositionError);
          return 1;
        },
        clearWatch: vi.fn(),
      },
    });
    const close = trackLocation(onPosition, onError);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Allow location access"),
    );
    expect(onPosition).not.toHaveBeenCalled();
    close();
  });
});
