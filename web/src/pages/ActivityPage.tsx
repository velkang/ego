import { useEffect, useState } from "react";
import { ArrowUpRight, Gift, ExternalLink } from "lucide-react";
import { explorerTransaction, formatUSDC } from "@jovva/chain";
import { api } from "../lib/api";
import { readWallet } from "../lib/wallet";
import type { Claim } from "../lib/types";
import { Spinner } from "../components/Spinner";
import { CampaignPage } from "./CampaignPage";

type Transfer = {
  id: string;
  amount: number;
  recipient: string;
  status: string;
  transactionHash: string | null;
  createdAt: number;
};
export function activityItems(claims: Claim[], transactions: Transfer[]) {
  return [
    ...claims.map((c) => ({
      id: `claim:${c.id}`,
      title: "Reward",
      detail: "Money drop or prize",
      amount: c.amount,
      status: c.status,
      hash: c.transactionHash,
      date: c.createdAt,
      incoming: true,
    })),
    ...transactions.map((t) => ({
      id: `send:${t.id}`,
      title: "Sent USDC",
      detail: `To ${t.recipient.slice(0, 6)}…${t.recipient.slice(-4)}`,
      amount: t.amount,
      status: t.status,
      hash: t.transactionHash,
      date: t.createdAt,
      incoming: false,
    })),
  ].sort((a, b) => b.date - a.date);
}
export function ActivityPage({
  signedIn,
  accountId,
  requestSignIn,
}: {
  signedIn: boolean;
  accountId: string;
  requestSignIn: () => void;
}) {
  const [items, setItems] = useState<ReturnType<typeof activityItems> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setError("");
    // One read on entry; Activity never subscribes to balance refresh timers.
    void Promise.all([
      readWallet(accountId),
      api<{ transactions: Transfer[] }>("/wallet/transactions"),
    ])
      .then(([wallet, history]) => {
        if (alive) setItems(activityItems(wallet.claims, history.transactions));
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [signedIn, accountId, revision]);
  return (
    <main className="page activity-page">
      <header className="page-heading">
        <h1>Activity</h1>
        <p>Your rewards, transfers, and campaigns.</p>
      </header>
      {!signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in to see activity
        </button>
      ) : (
        <>
          <section className="section">
            <div className="section-title">
              <h2>History</h2>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button
                  className="text-button"
                  onClick={() => setRevision((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {!items && !error ? (
              <Spinner label="Loading activity" />
            ) : items?.length ? (
              <div className="list-card">
                {items.map((item) => (
                  <article className="list-row" key={item.id}>
                    <span
                      className={`row-icon ${item.incoming ? "in" : "out"}`}
                    >
                      {item.incoming ? (
                        <Gift size={18} />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                    </span>
                    <span className="row-main">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                      <span>
                        {item.status === "confirmed"
                          ? "Confirmed"
                          : item.status === "failed"
                            ? "Failed"
                            : "Pending"}{" "}
                        · {new Date(item.date).toLocaleDateString()}
                      </span>
                    </span>
                    <span
                      className={`row-end activity-value ${item.incoming && item.status === "confirmed" ? "amount-in" : ""}`}
                    >
                      {item.status === "confirmed"
                        ? item.incoming
                          ? "+"
                          : "−"
                        : ""}
                      {formatUSDC(item.amount)}
                      <small>USDC</small>
                      {item.hash && (
                        <a
                          href={explorerTransaction(item.hash)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-button"
                          aria-label={`View transaction for ${item.title}`}
                        >
                          <ExternalLink size={16} />
                        </a>
                      )}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              !error && (
                <div className="empty-collection">
                  <h3>Nothing yet</h3>
                  <p>Your rewards and transfers will show up here.</p>
                </div>
              )
            )}
          </section>
          <CampaignPage
            path="/activity"
            signedIn={signedIn}
            requestSignIn={requestSignIn}
            managementOnly
          />
        </>
      )}
    </main>
  );
}
