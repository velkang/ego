export const walletAssets = [
  {
    symbol: "USDC",
    decimals: 6,
    address: "0x3600000000000000000000000000000000000000",
  },
  {
    symbol: "EURC",
    decimals: 6,
    address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  },
  {
    symbol: "cirBTC",
    decimals: 8,
    address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
  },
] as const;
export type AssetSymbol = (typeof walletAssets)[number]["symbol"];
export type FinanceKind =
  | "withdraw"
  | "swap"
  | "earn-deposit"
  | "earn-withdraw";
export type AssetBalance = {
  symbol: AssetSymbol;
  decimals: number;
  units: string | null;
};
export type FinanceCapabilities = {
  swap: boolean;
  swapPairs: { from: AssetSymbol; to: AssetSymbol }[];
  earn: boolean;
  earnDiscovery: boolean;
  withdraw: boolean;
  assets: readonly { symbol: AssetSymbol; decimals: number; address: string }[];
  destinations: {
    id: string;
    name: string;
    type: string;
    assets: AssetSymbol[];
  }[];
};
export type FinanceRequest = {
  kind: FinanceKind;
  asset: AssetSymbol;
  amount: string;
  outputAsset?: AssetSymbol;
  destination?: string;
  recipient?: string;
  slippageBps?: number;
  vaultAddress?: string;
};
export type FinanceFee = {
  symbol: string;
  amount: string;
  decimals: number;
  label: string;
};
export type FinanceQuote = {
  id: string;
  request: FinanceRequest;
  sourceChainId: 5042;
  expiresAt: number;
  estimatedReceived: string;
  minimumReceived: string;
  outputAsset: AssetSymbol;
  fees: FinanceFee[];
  networkFeeCap: string;
  networkFeeDecimals: 18;
  assetDecimals: number;
  outputDecimals: number;
  timing: string;
  vault?: { address: string; name: string; provider: string };
};
export type FinanceOperation = {
  id: string;
  kind: FinanceKind;
  asset: AssetSymbol;
  amount: string;
  outputAsset: AssetSymbol;
  status: "pending" | "confirmed" | "failed" | "needs-review";
  recipient?: string;
  destination?: string;
  vaultAddress?: string;
  createdAt: number;
  error: string | null;
  received?: { units: string; symbol: string; decimals: number };
  minimumReceived: string;
  outputDecimals: number;
  transactions: { phase: string; hash: string; url: string }[];
};
export type EarnSummary = {
  assetDecimals: 6;
  shareDecimals: number;
  vault: {
    address: string;
    name: string;
    provider: string;
    apy: number;
    fees: string;
    liquidity: string;
  };
  position: {
    principal: string | null;
    value: string;
    shares: string;
    gain: string | null;
  };
};
export function assetDefinition(symbol: AssetSymbol) {
  return walletAssets.find((a) => a.symbol === symbol)!;
}
export function assetUnits(value: string, decimals: number): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"))
  ).toString();
}
export function assetAmount(units: string, decimals: number): string {
  const value = BigInt(units),
    negative = value < 0n,
    absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const fraction = (absolute % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / base}${fraction ? `.${fraction}` : ""}`;
}

export type EarnVaultList = {
  page: number;
  hasMore: boolean;
  vaults: {
    address: string;
    name: string;
    provider: string;
    apy: number | null;
    performanceFee: number | null;
    managementFee: number | null;
    liquidity: string;
    decimals: 6;
    enabled: boolean;
  }[];
};
