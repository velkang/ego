import { describe, it, expect } from "vitest";
import { formatDistance, locationMessage } from "./location";
describe("visitor location feedback", () => {
  it("shows distances without false precision", () => {
    expect(formatDistance(49.7)).toBe("50 m");
    expect(formatDistance(1250)).toBe("1.3 km");
  });
  it("gives recovery advice for permission denial and timeout", () => {
    expect(locationMessage({ code: 1 } as GeolocationPositionError)).toContain(
      "browser settings",
    );
    expect(locationMessage({ code: 3 } as GeolocationPositionError)).toContain(
      "Try again",
    );
  });
});
