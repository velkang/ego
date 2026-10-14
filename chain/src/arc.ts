import { arc } from "viem/chains";
export { arc };
export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
export const explorerTransaction = (hash: string) =>
  `${arc.blockExplorers.default.url}/tx/${hash}`;
export function formatUSDC(amount: string | number | bigint) {
  const units =
    typeof amount === "number" ? BigInt(Math.trunc(amount)) : BigInt(amount);
  const absolute = units < 0n ? -units : units;
  const whole = (absolute / 1_000_000n).toLocaleString("en-US");
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${units < 0n ? "-" : ""}$${whole}.${fraction}`;
}
