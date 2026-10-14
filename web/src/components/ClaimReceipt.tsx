import { useEffect, useState, type CSSProperties } from "react";
import { Check, Clock, ExternalLink, Zap } from "lucide-react";
import { explorerTransaction, formatUSDC } from "@jovva/chain";
import { api } from "../lib/api";
import { invalidateWallet } from "../lib/wallet";
import type { Claim } from "../lib/types";
import { LargeCoin, Coin } from "./Coin";
import { Link } from "./Link";
import { Scene } from "./Scene";
export function ClaimReceipt({
  initial,
  venue,
  onContinue,
  onRetry,
}: {
  initial: Claim;
  venue: string;
  onContinue?: () => void;
  onRetry?: () => void;
}) {
  const [claim, setClaim] = useState(initial),
    [error, setError] = useState("");
  useEffect(() => {
    if (claim.status === "confirmed") invalidateWallet();
  }, [claim.id, claim.status]);
  useEffect(() => {
    if (!["reserved", "submitted"].includes(claim.status)) return;
    let alive = true;
    const timer = setInterval(() => {
      void api<{ claim: Claim }>(`/claims/${claim.id}`)
        .then((d) => {
          if (alive) {
            setClaim(d.claim);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [claim.id, claim.status]);
  const confirmed = claim.status === "confirmed",
    failed = claim.status === "failed";
  if (!confirmed)
    return (
      <Scene className="found-scene pending-scene">
        <div className="scene-top">
          <span />
          <span className="here-pill">
            {failed ? "Payout failed" : "Processing"}
          </span>
          <span />
        </div>
        <div className="scene-center">
          <LargeCoin size={210} />
        </div>
        <section className="found-sheet processing-sheet">
          <div className="found-sheet-scroll">
            <div className="found-title">
              <h1>
                {failed ? "Payout couldn’t complete" : "Confirming your reward"}
              </h1>
              <p>
                {failed
                  ? "Your reservation was released. You can try again."
                  : `${formatUSDC(claim.amount)} USDC is reserved. Waiting for the payout to be confirmed.`}
              </p>
              <Clock size={24} />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {failed && onRetry && (
              <button className="button primary" onClick={onRetry}>
                Try again
              </button>
            )}
            <Link className="button secondary" href="/">
              View wallet
            </Link>
          </div>
        </section>
      </Scene>
    );
  return (
    <Scene className="found-scene">
      <div className="scene-top">
        <span />
        <span className="here-pill">
          {confirmed ? "Found" : failed ? "Payout failed" : "Payout pending"}
        </span>
        <span />
      </div>
      <div className="scene-center">
        <div className="scene-coin">
          <LargeCoin size={210} entrance="drop" />
          {confirmed && (
            <div className="burst" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span
                  className="coin coin-sm"
                  key={i}
                  style={
                    {
                      "--x": `${Math.cos((i * Math.PI) / 4) * 130}px`,
                      "--y": `${Math.sin((i * Math.PI) / 4) * 110}px`,
                      "--r": `${i * 30}deg`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <section className="found-sheet" aria-labelledby="found-title">
        <span className="found-badge">
          <Coin />
        </span>
        <div className="found-sheet-scroll">
          <div className="found-title">
            <h1 id="found-title">
              {confirmed
                ? `You found ${formatUSDC(claim.amount)} USDC`
                : failed
                  ? "Your payout failed"
                  : "Your drop is on its way"}
            </h1>
            <p>
              {confirmed
                ? "Your reward was paid to your wallet."
                : failed
                  ? "Your reservation was released. You can try again."
                  : "Your reward is reserved while the payout is confirmed."}
            </p>
            <span className="in-wallet">
              {confirmed ? <Check size={14} /> : <Clock size={14} />}{" "}
              {confirmed
                ? "Paid to your wallet"
                : failed
                  ? "Failed"
                  : "Pending"}
            </span>
          </div>
          <dl className="found-facts">
            <div>
              <dt>Found at</dt>
              <dd>{venue}</dd>
            </div>
            <div>
              <dt>Reward</dt>
              <dd>{formatUSDC(claim.amount)} USDC</dd>
            </div>
            {confirmed && claim.confirmedAt && (
              <div>
                <dt>Confirmed in</dt>
                <dd>
                  <Zap size={14} />
                  {((claim.confirmedAt - claim.createdAt) / 1000).toFixed(
                    1,
                  )}{" "}
                  seconds
                </dd>
              </div>
            )}
          </dl>
          {confirmed && (
            <article className="collectible">
              <div className="collectible-art">
                <Coin />
              </div>
              <div className="collectible-info">
                <strong>{venue}</strong>
                <span>
                  {formatUSDC(claim.amount)} ·{" "}
                  {new Date(claim.createdAt).toLocaleDateString()}
                </span>
              </div>
            </article>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="found-actions">
            <Link className="button secondary" href="/">
              Wallet
            </Link>
            {confirmed && onContinue ? (
              <button className="button primary" onClick={onContinue}>
                Find another drop
              </button>
            ) : failed && onRetry ? (
              <button className="button primary" onClick={onRetry}>
                Try again
              </button>
            ) : (
              <Link className="button primary" href="/explore">
                Explore other campaigns
              </Link>
            )}
          </div>
          {claim.transactionHash && (
            <a
              className="explorer-link"
              href={explorerTransaction(claim.transactionHash)}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </section>
    </Scene>
  );
}
