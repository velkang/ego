import { assetAmount } from "@ego/chain";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Compass,
  Gift,
  Eye,
  EyeOff,
  Plus,
} from "lucide-react";
import { formatUSDC, explorerTransaction } from "@ego/chain";
import { post } from "../lib/api";
import { readWallet, type WalletSnapshot } from "../lib/wallet";
import { watchWallet } from "../lib/wallet-refresh";
import { Amount } from "../components/Amount";
import { Coin, LargeCoin } from "../components/Coin";
import { Link } from "../components/Link";
import { Spinner } from "../components/Spinner";
export function WalletPage({
  signedIn,
  accountId,
  requestSignIn,
  refreshKey = 0,
  onAction,
  onCreate,
}: {
  signedIn: boolean;
  accountId: string;
  requestSignIn: () => void;
  refreshKey?: number;
  onAction: (action: "send" | "receive") => void;
  onCreate: () => void;
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
        if (!result.balanceError || !quiet) {
          setData(result);
          setError("");
        }
      }
      return !result.balanceError;
    } catch (e) {
      if (current === generation.current && !quiet)
        setError((e as Error).message);
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
            USDC balance
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
              prefix="$"
              currency=""
            />
          ) : busy && signedIn ? (
            <Spinner label="Loading balance" />
          ) : (
            <strong className="amount">—</strong>
          )}
          {data?.wallet && data.balance === null && (
            <span className="balance-address" role="status">
              {!busy || data.balanceError ? "Balance unavailable." : null}
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
        <button
          type="button"
          className="action"
          onClick={() => onAction("send")}
          aria-haspopup="dialog"
        >
          <span className="action-icon">
            <ArrowUpRight size={22} />
          </span>
          Send
        </button>
        <button
          type="button"
          className="action"
          onClick={() => onAction("receive")}
          aria-haspopup="dialog"
        >
          <span className="action-icon">
            <ArrowDownLeft size={22} />
          </span>
          Receive
        </button>
        <Link href="/explore" className="action main">
          <span className="action-icon">
            <Compass size={22} />
          </span>
          Hunt
        </Link>
        <button
          type="button"
          className="action"
          onClick={onCreate}
          aria-haspopup="dialog"
        >
          <span className="action-icon">
            <Plus size={22} />
          </span>
          Create
        </button>
      </div>
      <Link href="/prizes" className="prize-teaser">
        <span className="row-icon">
          <Gift size={19} />
        </span>
        <span className="row-main">
          <strong>Prizes waiting for you</strong>
          <span>Won a hackathon or a bounty? Claim it with your email</span>
        </span>
        <ChevronRight size={18} />
      </Link>
      <section className="section">
        <div className="section-title">
          <h2>Coins</h2>
        </div>
        <div className="list-card">
          <div className="list-row coin-row">
            <img src="/tokens/usdc.svg" alt="" width={36} height={36} />
            <span className="row-main">
              <strong>USDC</strong>
              <span>US dollar · Circle</span>
            </span>
            <span className="row-end coin-value">
              {data?.balance != null ? (
                <Amount
                  base={data.balanceUnits ?? legacyUnits(data.balance)}
                  hidden={hidden}
                />
              ) : (
                "—"
              )}
            </span>
          </div>
          {data?.assets
            ?.filter((a) => a.symbol !== "USDC")
            .map((a) => (
              <div className="list-row coin-row" key={a.symbol}>
                <span className="token-initial" aria-hidden="true">
                  {a.symbol === "EURC" ? "E" : "B"}
                </span>
                <span className="row-main">
                  <strong>{a.symbol}</strong>
                  <span>
                    {a.symbol === "EURC" ? "Euro · Circle" : "Bitcoin · Circle"}
                  </span>
                </span>
                <span className="row-end coin-value">
                  {hidden
                    ? "••••"
                    : a.units === null
                      ? "—"
                      : assetAmount(a.units, a.decimals)}
                </span>
              </div>
            ))}
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <h2>Your collection</h2>
          <span>{confirmed.length} found</span>
        </div>
        {signedIn && !data ? (
          busy ? (
            <Spinner label="Loading collection" />
          ) : (
            <p role="status">Your collection couldn’t load.</p>
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
