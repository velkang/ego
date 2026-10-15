import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Vault } from "lucide-react";
import { assetAmount, type EarnOverview, type EarnVaultList } from "@ego/chain";
import { Amount } from "./Amount";
import { Link } from "./Link";
import { Spinner } from "./Spinner";
import { readEarnVaults } from "../lib/earn";
type VaultChoice = Pick<
  EarnVaultList["vaults"][number],
  "address" | "name" | "provider" | "apy"
>;
export function Investments({
  overview,
  accountId,
  busy,
  error,
  retry,
  hidden = false,
  onSelect,
  initialOpen,
  initialVaults,
}: {
  overview: EarnOverview | null;
  accountId: string;
  busy: boolean;
  error: string;
  retry: () => void;
  hidden?: boolean;
  initialOpen?: string;
  initialVaults?: EarnVaultList | null;
  onSelect?: (vault: VaultChoice) => void;
}) {
  const positions =
    overview?.positions.filter(
      (p) => BigInt(p.position.value) > 0n || BigInt(p.position.shares) > 0n,
    ) || [];
  const [available, setAvailable] = useState<EarnVaultList | null>(initialVaults || null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (initialVaults) {
      setAvailable(initialVaults);
      setCatalogBusy(false);
      return;
    }
    setAvailable(null);
    setCatalogError("");
    setCatalogBusy(true);
    void readEarnVaults(accountId)
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch((e) => {
        if (active) setCatalogError((e as Error).message);
      })
      .finally(() => {
        if (active) setCatalogBusy(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, revision, initialVaults]);
  // Keep every owned position, then fill the reference's three-card deck with available vaults.
  const cards: VaultChoice[] = [
    ...positions.map((position) => position.vault),
    ...(available?.vaults || [])
      .filter((vault) => !positions.some(
        (p) => p.vault.address.toLowerCase() === vault.address.toLowerCase(),
      ))
      .slice(0, Math.max(0, 3 - positions.length)),
  ];
  const [expanded, setExpanded] = useState<string | null>(initialOpen || null);
  const open = cards.some(
    (p) => p.address.toLowerCase() === expanded?.toLowerCase(),
  )
    ? expanded?.toLowerCase()
    : cards[0]?.address.toLowerCase();
  return (
    <section className="section investments-section" aria-label="Investments">
      <Link href="/earn" className="section-title section-link">
        <h2>Investments</h2>
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
      {catalogError && (
        <p className="error" role="alert">
          {catalogError}
          <button
            className="text-button"
            disabled={catalogBusy}
            onClick={() => setRevision((n) => n + 1)}
          >
            Retry vaults
          </button>
        </p>
      )}
      {busy && !overview && !cards.length ? (
        <Spinner label="Loading investments" />
      ) : (
        (overview || cards.length > 0) && (
          <>
            {!!overview?.unavailableVaults.length && (
              <p role="status">
                Some positions couldn’t load.{" "}
                <button className="text-button" disabled={busy} onClick={retry}>
                  Retry
                </button>
              </p>
            )}
            <div className="deck">
              {cards.length ? (
                cards.map((vault, index) => {
                  const position = positions.find(
                    (p) => p.vault.address.toLowerCase() === vault.address.toLowerCase(),
                  );
                  const address = vault.address,
                    active = address.toLowerCase() === open,
                    id = `investment-${address.toLowerCase()}`;
                  const change = position?.position.gain ?? null;
                  const body = (
                    <>
                      {position ? (
                        <Amount
                          base={position.position.value}
                          hidden={hidden}
                          currency="USDC"
                        />
                      ) : (
                        <p>Explore this USDC vault</p>
                      )}
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
                          {vault.apy === null
                            ? "APY unavailable"
                            : `${(vault.apy * 100).toFixed(2)}% variable APY`}
                        </span>
                        <span>{vault.provider}</span>
                      </div>
                      {onSelect ? (
                        <button
                          id={`manage-investment-${address.toLowerCase()}`}
                          className="deck-open"
                          onClick={() => onSelect(vault)}
                        >
                          {position ? "Manage position" : "Explore vault"}{" "}
                          <ArrowUpRight size={15} aria-hidden="true" />
                        </button>
                      ) : (
                        <Link
                          className="deck-open"
                          href={`/earn?vault=${address}`}
                        >
                          {position ? "Manage position" : "Explore vault"}{" "}
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
                          {vault.name}
                        </span>
                        {!active && (
                          <span className="deck-amount">
                            {position
                              ? hidden
                                ? "••••"
                                : `${assetAmount(position.position.value, 6)} USDC`
                              : "USDC"}
                          </span>
                        )}
                      </button>
                      <div className="deck-body" id={id} inert={!active}>
                        <div>{body}</div>
                      </div>
                    </article>
                  );
                })
              ) : catalogBusy ? (
                <Spinner label="Loading investment vaults" />
              ) : (
                <article className="deck-card open">
                  <div className="deck-head">
                    <span className="deck-icon">
                      <Vault size={16} aria-hidden="true" />
                    </span>
                    <span className="deck-title">USDC vaults</span>
                  </div>
                  <div className="deck-empty">
                    <p>
                      {overview?.unavailableVaults.length
                        ? "Your positions are temporarily unavailable."
                        : "No USDC vaults are available right now."}
                    </p>
                    <Link href="/earn" className="deck-open">
                      Explore vaults{" "}
                      <ArrowUpRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
