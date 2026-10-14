import { useEffect, useState } from "react";
import { api } from "./api";
import type { FinanceCapabilities } from "@ego/chain";
const unavailable: FinanceCapabilities = {
  swap: false,
  swapPairs: [],
  earn: false,
  earnDiscovery: false,
  withdraw: false,
  assets: [],
  destinations: [],
};
export function useFinanceCapabilities(signedIn: boolean, accountId: string) {
  const [result, setResult] = useState<{
    accountId: string;
    value: FinanceCapabilities;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    if (signedIn)
      void api<FinanceCapabilities>("/wallet/capabilities")
        .then((value) => {
          if (alive) setResult({ accountId, value });
        })
        .catch(() => {
          if (alive) setResult({ accountId, value: unavailable });
        });
    return () => {
      alive = false;
    };
  }, [signedIn, accountId]);
  return {
    ...(signedIn && result?.accountId === accountId
      ? result.value
      : unavailable),
    loading: signedIn && result?.accountId !== accountId,
  };
}
