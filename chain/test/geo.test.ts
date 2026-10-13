import { describe, it, expect } from "vitest";
import { distanceMeters, locationError } from "../src/geo";
const now = 1_000_000,
  spot = { latitude: 6.45, longitude: 3.39, radius: 50 };
describe("location eligibility", () => {
  it("allows fresh accurate readings inside the radius", () =>
    expect(
      locationError({ ...spot, accuracy: 5, timestamp: now }, spot, now),
    ).toBeNull());
  it("rejects stale, future, inaccurate and invalid readings", () => {
    expect(
      locationError(
        { ...spot, accuracy: 5, timestamp: now - 15001 },
        spot,
        now,
      ),
    ).toBe("STALE_LOCATION");
    expect(
      locationError({ ...spot, accuracy: 5, timestamp: now + 2001 }, spot, now),
    ).toBe("STALE_LOCATION");
    expect(
      locationError({ ...spot, accuracy: 51, timestamp: now }, spot, now),
    ).toBe("LOCATION_INACCURATE");
    expect(
      locationError(
        { ...spot, latitude: NaN, accuracy: 5, timestamp: now },
        spot,
        now,
      ),
    ).toBe("INVALID_LOCATION");
  });
  it("handles overlap and radius boundaries", () => {
    const near = {
      ...spot,
      latitude: spot.latitude + 0.00044,
      accuracy: 5,
      timestamp: now,
    };
    expect(distanceMeters(near, spot)).toBeLessThan(50);
    expect(locationError(near, spot, now)).toBeNull();
    expect(
      locationError({ ...near, latitude: spot.latitude + 0.00046 }, spot, now),
    ).toBe("TOO_FAR");
    expect(
      locationError(
        near,
        { ...spot, longitude: spot.longitude + 0.00001 },
        now,
      ),
    ).toBeNull();
  });
});
