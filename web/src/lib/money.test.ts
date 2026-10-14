import { expect, it } from "vitest";
import { decimalUnits } from "../pages/WalletActionPage";
it("parses six decimal USDC values without floating point rounding", () => {
  expect(decimalUnits("0.000001")).toBe(1);
  expect(decimalUnits("5.123456")).toBe(5123456);
  expect(decimalUnits("100")).toBe(100000000);
  for (const value of ["0", "-1", "1.0000001", "1e6", "NaN", ""])
    expect(() => decimalUnits(value)).toThrow();
});
