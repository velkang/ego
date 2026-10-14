import { expect, it } from "vitest";
import { formatUSDC } from "../src/arc";
it("shows micro-USDC and large integer amounts without float rounding", () => {
  expect(formatUSDC(1)).toBe("$0.000001");
  expect(formatUSDC(10000)).toBe("$0.01");
  expect(formatUSDC(1000000)).toBe("$1.00");
  expect(formatUSDC(5123456)).toBe("$5.123456");
  expect(formatUSDC("9007199254740991")).toBe("$9,007,199,254.740991");
});
