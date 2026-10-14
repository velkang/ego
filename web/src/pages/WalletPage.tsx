import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Compass,
  Gift,
  Trophy,
  Eye,
  EyeOff,
  Plus,
  Puzzle,
  QrCode,
  Ticket,
  RefreshCw,
} from "lucide-react";
import { formatUSDC, explorerTransaction } from "@jovva/chain";
import { post } from "../lib/api";
import { readWallet, type WalletSnapshot } from "../lib/wallet";
import { watchWallet } from "../lib/wallet-refresh";
import { Amount } from "../components/Amount";
import { Coin, LargeCoin } from "../components/Coin";
import { Link } from "../components/Link";
import { Spinner } from "../components/Spinner";
const ways = [
  {
    href: "/prizes",
    icon: Gift,
    title: "Prizes waiting for you",
    sub: "Claim prizes and bounties with your email",
  },
  {
    href: "/enter/code",
    icon: Ticket,
    title: "Enter a code",
    sub: "From a giveaway, a post or a flyer",
  },
  {
    href: "/enter/qr",
    icon: QrCode,
    title: "Scan an event QR",
    sub: "Scan the code to find your reward",
  },
  {
    href: "/enter/puzzle",
    icon: Puzzle,
    title: "Solve a puzzle",
    sub: "Crack the riddle, keep the coin",
  },
];
const organisers = [
  {
    href: "/pay",
    icon: Trophy,
    title: "Pay winners",
    sub: "Fund prizes that winners claim with their email",
  },
  {
    href: "/hide",
    icon: Plus,
    title: "Hide money",
    sub: "Place USDC drops for people to find",
  },
  {
    href: "/create",
    icon: Ticket,
    title: "Codes, event QR codes and puzzles",
    sub: "Giveaways with a code, a scan or an answer",
  },
];
export function WalletPage({
  signedIn,
  accountId,
  requestSignIn,
  refreshKey = 0,
}: {
  signedIn: boolean;
  accountId: string;
  requestSignIn: () => void;
  refreshKey?: number;
}) {
  const generation = useRef(0);
  const [data, setData] = useState<WalletSnapshot | null>(null),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false);
  async function load(refresh = false, quiet = false) {
    if (!signedIn) return false;
    const current = ++generation.current;
    if (!quiet) {
      setBusy(true);
      setError("");
    }
    try {
      let result = await readWallet(accountId, refresh);
      if (!result.wallet) {
        const created = await post<{ wallet: { address: string } }>("/wallet");
        // Provisioning has succeeded even if the subsequent balance read fails.
        if (current === generation.current)
          setData({
            ...result,
            wallet: created.wallet,
            balance: null,
            balanceUnits: null,
            balanceError: null,
          });
        result = await readWallet(accountId);
      }
      if (current === generation.current) {
        if (result.balanceError && quiet) {
          setError("Couldn’t update your balance. We’ll retry automatically.");
        } else {
          setData(result);
          setError("");
        }
      }
      return !result.balanceError;
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
      return false;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (signedIn) void load();
    else setData(null);
    return () => {
      generation.current++;
    };
  }, [signedIn, accountId, refreshKey]);
  useEffect(() => {
    if (signedIn) return watchWallet(() => load(false, true));
  }, [signedIn, accountId]);
  const confirmed = data?.claims.filter((c) => c.status === "confirmed") ?? [];
  return (
    <main className="page wallet-home">
      <Link href="/explore" className="drop-banner">
        <Coin small />
        <div>
          <strong>Find your next money drop</strong>
          <span>Open the map to look around</span>
        </div>
        <ChevronRight size={20} />
      </Link>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load(true)}
          >
            Retry
          </button>
        </div>
      )}
      <section className="balance" aria-label="Your wallet">
        <div className="balance-text">
          <span className="balance-label">
            Total balance
            <button
              onClick={() => setHidden((v) => !v)}
              aria-label={hidden ? "Show balance" : "Hide balance"}
            >
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          {data && data.balance !== null ? (
            <Amount
              base={data.balanceUnits ?? legacyUnits(data.balance)}
              hidden={hidden}
            />
          ) : busy && signedIn ? (
            <Spinner label="Loading balance" />
          ) : (
            <strong className="amount">—</strong>
          )}
          {data?.wallet && data.balance === null && (
            <span className="balance-address" role="status">
              {!busy || data.balanceError
                ? "Balance unavailable. Try refreshing."
                : null}
            </span>
          )}
          <span className="balance-address">
            {data?.wallet
              ? `${data.wallet.address.slice(0, 6)}…${data.wallet.address.slice(-4)}`
              : signedIn
                ? busy
                  ? null
                  : "Wallet is unavailable"
                : "Sign in to open your wallet"}
          </span>
        </div>
        <LargeCoin size={132} />
      </section>
      {!signedIn && (
        <button className="button primary" onClick={requestSignIn}>
          Sign in
        </button>
      )}
      <div className="actions">
        {[
          { href: "/wallet/send", icon: ArrowUpRight, label: "Send" },
          { href: "/wallet/receive", icon: ArrowDownLeft, label: "Receive" },
          { href: "/explore", icon: Compass, label: "Hunt" },
          { href: "/hide", icon: Plus, label: "Hide" },
        ].map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={`action ${label === "Hunt" ? "main" : ""}`}
          >
            <span className="action-icon">
              <Icon size={22} />
            </span>
            {label}
          </Link>
        ))}
      </div>
      {[
        { title: "Ways to find money", rows: ways },
        { title: "For organisers", rows: organisers },
      ].map(({ title, rows }) => (
        <section className="section" key={title}>
          <div className="section-title">
            <h2>{title}</h2>
          </div>
          <div className="list-card">
            {rows.map(({ href, icon: Icon, title, sub }) => (
              <Link href={href} className="list-row" key={href}>
                <span className="row-icon">
                  <Icon size={19} />
                </span>
                <span className="row-main">
                  <strong>{title}</strong>
                  <span>{sub}</span>
                </span>
                <span className="row-end">
                  <ChevronRight size={18} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section className="section">
        <div className="section-title">
          <h2>Your collection</h2>
          <span>{confirmed.length} found</span>
        </div>
        {signedIn && !data ? (
          busy ? (
            <Spinner label="Loading collection" />
          ) : (
            <p role="status">
              Your collection couldn’t load. Refresh your wallet to try again.
            </p>
          )
        ) : confirmed.length ? (
          <div className="collection-scroll">
            {confirmed.map((c) => (
              <article className="claim-card" key={c.id}>
                <Coin />
                <strong>{formatUSDC(c.amount)}</strong>
                <span>
                  Collected {new Date(c.createdAt).toLocaleDateString()}
                </span>
                {c.transactionHash && (
                  <a
                    href={explorerTransaction(c.transactionHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    View receipt
                    <ChevronRight size={16} />
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-collection">
            <Coin />
            <h3>Your first find is waiting</h3>
            <p>Your confirmed rewards become cards in your collection.</p>
            <Link href="/explore" className="text-button">
              Take a look around
              <ChevronRight size={16} />
            </Link>
          </div>
        )}
      </section>
      {data?.claims.some((c) => c.status !== "confirmed") && (
        <section className="section">
          <h2>Recent claims</h2>
          {data.claims
            .filter((c) => c.status !== "confirmed")
            .map((c) => (
              <div className="history-row" key={c.id}>
                <Coin small />
                <span>
                  {formatUSDC(c.amount)} ·{" "}
                  {c.status === "failed" ? "Failed" : "Pending"}
                </span>
              </div>
            ))}
        </section>
      )}
      {signedIn && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? (
            <Spinner inline label="Refreshing wallet" />
          ) : (
            <>
              <RefreshCw size={16} />
              Refresh wallet
            </>
          )}
        </button>
      )}
    </main>
  );
}

function legacyUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6))
  ).toString();
}
