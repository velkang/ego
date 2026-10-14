import {
  assetAmount,
  assetDefinition,
  type FinanceOperation,
} from "@ego/chain";
import { useEffect, useState } from "react";
import { ArrowUpRight, Gift, ExternalLink } from "lucide-react";
import { explorerTransaction, formatUSDC } from "@ego/chain";
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
      finance: null as FinanceOperation | null,
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
      finance: null as FinanceOperation | null,
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
  const [statusStopped, setStatusStopped] = useState(false),
    [statusRevision, setStatusRevision] = useState(0);
  const pendingIds =
    items
      ?.filter((item) => item.finance?.status === "pending")
      .map((item) => item.finance!.id)
      .join(",") || "";
  useEffect(() => {
    if (!pendingIds) return;
    let active = true,
      running = false,
      failures = 0,
      timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    setStatusStopped(false);
    const schedule = () => {
      timer = setTimeout(poll, Math.min(60_000, 5000 * 2 ** failures));
    };
    const poll = async () => {
      if (!active) return;
      if (Date.now() - started > 10 * 60_000) {
        setStatusStopped(true);
        return;
      }
      if (running || document.hidden || !navigator.onLine) {
        schedule();
        return;
      }
      running = true;
      try {
        const updates = await Promise.all(
          pendingIds
            .split(",")
            .map((id) =>
              api<{ operation: FinanceOperation }>(`/finance/operations/${id}`),
            ),
        );
        if (active)
          setItems(
            (old) =>
              old?.map((item) => {
                const op = updates.find(
                  (u) => u.operation.id === item.finance?.id,
                )?.operation;
                return op ? { ...item, status: op.status, finance: op } : item;
              }) || null,
          );
        failures = 0;
      } catch {
        failures = Math.min(4, failures + 1);
      } finally {
        running = false;
        if (active) schedule();
      }
    };
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingIds, accountId, statusRevision]);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setError("");
    // One read on entry; Activity never subscribes to balance refresh timers.
    void Promise.all([
      readWallet(accountId),
      api<{ transactions: Transfer[] }>("/wallet/transactions"),
      api<{ operations: FinanceOperation[] }>("/finance/operations"),
    ])
      .then(([wallet, history, finance]) => {
        if (alive)
          setItems(
            [
              ...activityItems(wallet.claims, history.transactions),
              ...finance.operations.map((op) => ({
                id: `finance:${op.id}`,
                title:
                  op.kind === "swap"
                    ? "Swap"
                    : op.kind === "earn-deposit"
                      ? "Earn deposit"
                      : op.kind === "earn-withdraw"
                        ? "Earn withdrawal"
                        : `Sent ${op.asset}`,
                detail: op.destination
                  ? `To ${op.destination}`
                  : op.kind === "swap"
                    ? `${op.asset} to ${op.outputAsset}`
                    : "USDC lending",
                amount: 0,
                status: op.status,
                hash: null,
                date: op.createdAt,
                incoming: op.kind === "earn-withdraw",
                finance: op,
              })),
            ].sort((a, b) => b.date - a.date),
          );
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
                            : item.status === "needs-review"
                              ? "Review required"
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
                      {item.finance
                        ? `${assetAmount(item.finance.amount, assetDefinition(item.finance.asset).decimals)} ${item.finance.asset}`
                        : formatUSDC(item.amount)}
                      <small>{item.finance ? "" : "USDC"}</small>
                      {item.finance?.transactions.map((tx) => (
                        <a
                          key={`${tx.phase}:${tx.hash}`}
                          className="text-button"
                          href={tx.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${tx.phase} transaction`}
                        >
                          <ExternalLink size={16} />
                        </a>
                      ))}
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
          {statusStopped && pendingIds && (
            <button
              className="button secondary"
              onClick={() => setStatusRevision((n) => n + 1)}
            >
              Check pending transfers
            </button>
          )}
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
