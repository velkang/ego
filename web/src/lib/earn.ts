import { useEffect, useRef, useState } from "react";
import type { EarnOverview } from "@ego/chain";
import { api } from "./api";
let cached:
  | {
      accountId: string;
      value?: EarnOverview;
      time?: number;
      pending?: Promise<EarnOverview>;
    }
  | undefined;
export function invalidateEarn() {
  cached = undefined;
}
async function readEarn(accountId: string, refresh = false) {
  if (cached?.accountId !== accountId) cached = { accountId };
  const entry = cached;
  if (entry.pending) return entry.pending;
  if (!refresh && entry.value && Date.now() - entry.time! < 30000)
    return entry.value;
  entry.pending = api<EarnOverview>("/earn")
    .then((value) => {
      entry.value = value;
      entry.time = Date.now();
      return value;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}
export function useEarnOverview(signedIn: boolean, accountId: string) {
  const [data, setData] = useState<EarnOverview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load(refresh = false) {
    const current = ++generation.current;
    if (!signedIn) {
      setData(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = await readEarn(accountId, refresh);
      if (generation.current === current) setData(value);
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [signedIn, accountId]);
  return {
    data,
    busy,
    error,
    refresh: () => {
      invalidateEarn();
      void load(true);
    },
  };
}
