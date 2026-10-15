import { useState } from "react";
import { ArrowUpRight, ChevronRight, Vault } from "lucide-react";
import { assetAmount, type EarnOverview, type EarnSummary } from "@ego/chain";
import { Amount } from "./Amount";
import { Link } from "./Link";
export function Investments({
  overview,
  busy,
  error,
  retry,
  hidden = false,
  onSelect,
  initialOpen,
}: {
  overview: EarnOverview | null;
  busy: boolean;
  error: string;
  retry: () => void;
  hidden?: boolean;
  initialOpen?: string;
  onSelect?: (vault: EarnSummary["vault"]) => void;
}) {
  const positions =
    overview?.positions.filter(
      (p) => BigInt(p.position.value) > 0n || BigInt(p.position.shares) > 0n,
    ) || [];
  const [expanded, setExpanded] = useState<string | null>(initialOpen || null);
  const open = positions.some(
    (p) => p.vault.address.toLowerCase() === expanded?.toLowerCase(),
  )
    ? expanded?.toLowerCase()
    : positions[0]?.vault.address.toLowerCase();
  if (!positions.length) return null;
  return (
    <section className="section investments-section" aria-label="Investments">
      <Link href="/earn" className="section-title section-link">
        <h2>{onSelect ? "Your positions" : "Investments"}</h2>
        <span>
          {overview?.totalValue != null
            ? hidden
              ? "••••"
              : `${assetAmount(overview.totalValue, 6)} USDC`
            : ""}
          <ChevronRight size={15} aria-hidden="true" />
        </span>
      </Link>
      {error && (
        <p className="error" role="alert">
          {error}
          <button className="text-button" disabled={busy} onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {!!overview?.unavailableVaults.length && (
        <p role="status">
          Some positions couldn’t load.{" "}
          <button className="text-button" disabled={busy} onClick={retry}>
            Retry
          </button>
        </p>
      )}
      <div className="deck">
        {positions.map((position, index) => {
          const address = position.vault.address,
            active = address.toLowerCase() === open,
            id = `investment-${address.toLowerCase()}`;
          const change = position.position.gain;
          const body = (
            <>
              <Amount
                base={position.position.value}
                hidden={hidden}
                currency="USDC"
              />
              {change !== null && !hidden && (
                <span
                  className={`deck-earned${BigInt(change) < 0n ? " loss" : ""}`}
                >
                  {BigInt(change) > 0n ? "+" : ""}
                  {assetAmount(change, 6)} USDC gain / loss
                </span>
              )}
              <div className="deck-meta">
                <span className="deck-rate">
                  {(position.vault.apy * 100).toFixed(2)}% variable APY
                </span>
                <span>{position.vault.provider}</span>
              </div>
                {onSelect ? (
                  <button
                    id={`manage-investment-${address.toLowerCase()}`}
                    className="deck-open"
                    onClick={() => onSelect(position.vault)}
                  >
                    Manage position{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <Link
                    className="deck-open"
                    href={`/earn?vault=${address}`}
                  >
                    Manage position{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                )}
              </>
            );
            return (
              <article
                className={`deck-card${active ? " open" : ""}`}
                style={{
                  zIndex: index + 1,
                  viewTransitionName: `vault-${address.toLowerCase()}`,
                }}
                key={address}
              >
                <button
                  className="deck-head"
                  aria-expanded={active}
                  aria-controls={id}
                  onClick={() => setExpanded(address)}
                >
                  <span className="deck-icon">
                    <Vault size={16} aria-hidden="true" />
                  </span>
                  <span className="deck-title">
                    {position.vault.name}
                  </span>
                  {!active && (
                    <span className="deck-amount">
                      {hidden
                        ? "••••"
                        : `${assetAmount(position.position.value, 6)} USDC`}
                    </span>
                  )}
                </button>
                <div className="deck-body" id={id} inert={!active}>
                  <div>{body}</div>
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}
