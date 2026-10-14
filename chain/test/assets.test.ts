import { expect, it } from "vitest";
import { assetAmount, assetUnits, walletAssets } from "../src/finance";
it("round-trips stablecoin and bitcoin precision without floating point", () => {
  for (const asset of walletAssets) {
    const raw = "999999999999999999999999";
    expect(assetUnits(assetAmount(raw, asset.decimals), asset.decimals)).toBe(
      raw,
    );
  }
  expect(assetUnits("0.00000001", 8)).toBe("1");
  expect(assetAmount("51025", 6)).toBe("0.051025");
  expect(assetAmount("-1", 8)).toBe("-0.00000001");
});
it("rejects exponent notation and excess precision instead of rounding", () => {
  for (const value of ["1e6", "-1", ".5", "01", "0.0000001", "NaN"])
    expect(() => assetUnits(value, 6)).toThrow();
});
