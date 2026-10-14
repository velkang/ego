import type { AssetBalance } from "@ego/chain";
import { api } from "./api";
import type { Claim } from "./types";

export type WalletSnapshot = {
  wallet: { address: string } | null;
  balance: string | null;
  balanceUnits?: string | null;
  assets?: AssetBalance[];
  balanceError?: "BALANCE_UNAVAILABLE" | null;
  claims: Claim[];
};

// Memory only: never persist authenticated wallet data.
let cached:
  | {
      accountId: string;
      value?: WalletSnapshot;
      updatedAt?: number;
      pending?: Promise<WalletSnapshot>;
    }
  | undefined;

export function invalidateWallet() {
  cached = undefined;
}

export function readWallet(
  accountId: string,
  refresh = false,
): Promise<WalletSnapshot> {
  if (cached?.accountId !== accountId) cached = { accountId };
  const entry = cached;
  if (entry.pending) return entry.pending;
  if (!refresh && entry.value && Date.now() - entry.updatedAt! < 15_000)
    return Promise.resolve(entry.value);
  entry.pending = api<WalletSnapshot>("/wallet")
    .then((value) => {
      if (value.assets && entry.value?.assets)
        value = {
          ...value,
          assets: value.assets.map((asset) =>
            asset.units === null
              ? entry.value!.assets!.find(
                  (saved) => saved.symbol === asset.symbol,
                ) || asset
              : asset,
          ),
        };
      if (value.wallet && value.balance !== null) {
        entry.value = value;
        entry.updatedAt = Date.now();
      }
      return value;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}
