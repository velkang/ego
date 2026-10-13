import { useEffect, useState } from "react";
import { formatUSDC, explorerTransaction, arcTestnet } from "@jovva/chain";
import { api, post } from "../lib/api";
import type { Claim } from "../lib/types";
import { Icon } from "../components/Icon";
import { Coin } from "../components/Coin";
export function WalletPage({
  signedIn,
  requestSignIn,
}: {
  signedIn: boolean;
  requestSignIn: () => void;
}) {
  const [data, setData] = useState<{
      wallet: { address: string } | null;
      balance: string;
      claims: Claim[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      let result = await api<typeof data & {}>("/wallet");
      if (!result.wallet) {
        await post("/wallet");
        result = await api("/wallet");
      }
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);
  if (!signedIn)
    return (
      <main className="page">
        <div className="empty-state">
          <Coin />
          <h1>Your adventures add up.</h1>
          <p>Sign in to see your rewards and your Jovva wallet.</p>
          <button className="button primary" onClick={requestSignIn}>
            Sign in
            <Icon name="arrow" />
          </button>
        </div>
      </main>
    );
  return (
    <main className="page wallet-page">
      <div className="section-heading">
        <div>
          <h1>Your little treasury.</h1>
          <p>The rewards you’ve found along the way.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh wallet"
          disabled={busy}
          onClick={() => void load()}
        >
          <Icon name="locate" />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="wallet-balance">
        <Coin />
        <span>USDC balance</span>
        <strong>{data ? formatUSDC(Number(data.balance) * 1e6) : "—"}</strong>

        {data?.wallet && (
          <button
            className="address-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(data.wallet!.address)
                .then(() => setCopied(true))
                .catch(() =>
                  setError(
                    "Couldn’t copy the address. Open it in the explorer instead.",
                  ),
                );
            }}
          >
            {copied
              ? "Address copied"
              : `${data.wallet.address.slice(0, 8)}…${data.wallet.address.slice(-6)}`}
          </button>
        )}
        {data?.wallet && (
          <a
            className="text-button"
            href={`${arcTestnet.blockExplorers.default.url}/address/${data.wallet.address}`}
            target="_blank"
            rel="noreferrer"
          >
            View wallet
            <Icon name="external" size={15} />
          </a>
        )}
      </section>
      <section className="wallet-history">
        <h2>Your finds</h2>
        {busy && !data ? (
          <p role="status">Opening your wallet…</p>
        ) : !data?.claims.length ? (
          <div className="empty-state compact">
            <Icon name="compass" size={30} />
            <h3>Your first find is waiting.</h3>
            <p>Pick an event and follow a drop.</p>
          </div>
        ) : (
          <div>
            {data.claims.map((claim) => (
              <div className="history-row" key={claim.id}>
                <Coin small />
                <div>
                  <strong>{formatUSDC(claim.amount)} drop</strong>
                  <small>
                    {new Date(claim.createdAt).toLocaleDateString()} ·{" "}
                    {claim.status === "reserved" || claim.status === "submitted"
                      ? "Pending"
                      : claim.status}
                  </small>
                </div>
                {claim.transactionHash ? (
                  <a
                    className="icon-button"
                    href={explorerTransaction(claim.transactionHash)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View payout transaction"
                  >
                    <Icon name="external" />
                  </a>
                ) : (
                  <Icon
                    name={claim.status === "confirmed" ? "check" : "clock"}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="wallet-disclosure">
        Jovva manages this wallet through Circle.
      </p>
    </main>
  );
}
