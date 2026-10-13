import { defineChain } from "viem";
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
});
export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
export const explorerTransaction = (hash: string) =>
  `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
export function formatUSDC(amount: string | number | bigint) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(amount) / 1e6);
}
