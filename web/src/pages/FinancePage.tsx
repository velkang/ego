import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Search,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { assetAmount, type EarnSummary, type EarnVaultList } from "@ego/chain";
import { useFinanceCapabilities } from "../lib/finance";
import { api } from "../lib/api";
import { FinanceForm } from "../components/FinanceForm";
import { Spinner } from "../components/Spinner";
import { Amount } from "../components/Amount";
import { Investments } from "../components/Investments";
import { readEarnVaults, useEarnOverview } from "../lib/earn";

type Vault = Pick<
  EarnVaultList["vaults"][number],
  "address" | "name" | "provider"
>;
const percent = (value: number | null) =>
  value === null ? "Unavailable" : `${(value * 100).toFixed(2)}%`;
export function FinancePage({
  path,
  signedIn,
  accountId,
  requestSignIn,
}: {
  path: string;
  signedIn: boolean;
  accountId: string;
  requestSignIn: () => void;
}) {
  const capabilities = useFinanceCapabilities(signedIn, accountId);
  const earning = path === "/earn";
  const [vaults, setVaults] = useState<EarnVaultList | null>(null);
  const portfolio = useEarnOverview(signedIn && earning, accountId);
  const [selected, setSelected] = useState<Vault | null>(() => {
    const address = new URLSearchParams(window.location.search).get("vault");
    return address && /^0x[0-9a-fA-F]{40}$/.test(address)
      ? { address, name: "Vault", provider: "USDC vault" }
      : null;
  });
  const [summary, setSummary] = useState<EarnSummary | null>(null);
  const [error, setError] = useState(""),
    [vaultError, setVaultError] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false),
    [withdrawing, setWithdrawing] = useState(false);
  const [search, setSearch] = useState(""),
    [revision, setRevision] = useState(0);
  const selectionSource = useRef<"deck" | "discovery">(
    new URLSearchParams(window.location.search).has("vault")
      ? "deck"
      : "discovery",
  );
  const heading = useRef<HTMLHeadingElement>(null),
    results = useRef<HTMLParagraphElement>(null);
  const generation = useRef(0),
    focusResults = useRef(false),
    lastSelected = useRef("");
  async function loadVaults(page = 1) {
    const current = generation.current;
    setVaultBusy(true);
    setVaultError("");
    try {
      const result = await (page === 1
        ? readEarnVaults(accountId)
        : api<EarnVaultList>(`/earn/vaults?page=${page}`));
      if (current !== generation.current) return;
      focusResults.current = page > 1;
      setVaults((previous) =>
        page === 1
          ? result
          : {
              ...result,
              vaults: [
                ...(previous?.vaults || []),
                ...result.vaults.filter(
                  (v) =>
                    !previous?.vaults.some(
                      (saved) =>
                        saved.address.toLowerCase() === v.address.toLowerCase(),
                    ),
                ),
              ],
            },
      );
    } catch (e) {
      if (current === generation.current) setVaultError((e as Error).message);
    } finally {
      if (current === generation.current) setVaultBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    if (earning && signedIn) {
      setVaults(null);
      void loadVaults();
    }
    return () => {
      generation.current++;
    };
  }, [earning, signedIn, accountId]);
  useEffect(() => {
    if (focusResults.current) {
      focusResults.current = false;
      results.current?.focus();
    }
  }, [vaults]);
  useEffect(() => {
    if (selected) {
      lastSelected.current = selected.address.toLowerCase();
      heading.current?.focus();
    } else if (lastSelected.current) {
      const target = document.getElementById(
        `${selectionSource.current === "deck" ? "manage-investment" : "vault"}-${lastSelected.current}`,
      );
      (target || heading.current)?.focus();
    }
  }, [selected]);
  useEffect(() => {
    let active = true;
    setSummary((previous) =>
      previous?.vault.address.toLowerCase() === selected?.address.toLowerCase()
        ? previous
        : null,
    );
    setError("");
    if (earning && selected && signedIn) {
      void api<EarnSummary>(
        `/earn?vault=${encodeURIComponent(selected.address)}`,
      )
        .then((data) => {
          if (active) setSummary(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [earning, selected?.address, accountId, revision, signedIn]);
  const selectedIdentity =
    summary?.vault.address.toLowerCase() === selected?.address.toLowerCase()
      ? summary?.vault
      : selected;
  const visible =
    vaults?.vaults.filter((v) =>
      `${v.name} ${v.provider}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ) || [];
  return (
    <main className="page finance-page">
      {selected && (
        <button
          className="text-button vault-back"
          onClick={() => {
            setSelected(null);
            history.replaceState({}, "", "/earn");
          }}
        >
          <ArrowLeft size={18} aria-hidden="true" /> All vaults
        </button>
      )}
      <header className="page-heading">
        <h1 ref={heading} tabIndex={-1}>
          {earning ? selectedIdentity?.name || "Earn" : "Swap"}
        </h1>
        <p>
          {earning
            ? selected
              ? selectedIdentity?.provider
              : "Explore USDC lending vaults. Returns vary."
            : "Exchange assets in your wallet."}
        </p>
        {earning && !selected && signedIn && (
          <div className="earn-overview">
            {portfolio.busy && !portfolio.data ? (
              <Spinner label="Loading Earn overview" />
            ) : portfolio.data?.totalValue != null ? (
              <Amount base={portfolio.data.totalValue} currency="USDC" />
            ) : (
              <strong className="amount">—</strong>
            )}
            <p>
              {portfolio.data?.gain != null ? (
                <span
                  className={
                    BigInt(portfolio.data.gain) < 0n
                      ? "deck-earned loss"
                      : "deck-earned"
                  }
                >
                  {BigInt(portfolio.data.gain) > 0n ? "+" : ""}
                  {assetAmount(portfolio.data.gain, 6)} USDC gain / loss
                </span>
              ) : (
                "Gain / loss unavailable"
              )}{" "}
              · Positions opened through Ego
            </p>
          </div>
        )}
      </header>
      {!signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in
        </button>
      ) : capabilities.loading ? (
        <Spinner label="Opening wallet features" />
      ) : !earning && !capabilities.swap ? (
        <section className="finance-flow" role="status">
          <p>Unable to load swap routes.</p>
          <button className="button secondary" onClick={capabilities.retry}>
            Retry
          </button>
        </section>
      ) : !earning ? (
        <FinanceForm
          kind="swap"
          capabilities={capabilities}
          accountId={accountId}
          requestSignIn={requestSignIn}
        />
      ) : selected ? (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => setRevision((n) => n + 1)}
              >
                Retry
              </button>
            </p>
          )}
          {!summary ? (
            !error && <Spinner label="Loading vault and position" />
          ) : (
            <>
              <section
                className="earn-position grow-hero"
                aria-label="Your vault position"
                style={{
                  viewTransitionName: `vault-${summary.vault.address.toLowerCase()}`,
                }}
              >
                <span className="position-label">Your position</span>
                <Amount base={summary.position.value} currency="USDC" />
                <div className="grow-stats">
                  <div>
                    <span>Variable APY</span>
                    <strong>{percent(summary.vault.apy)}</strong>
                  </div>
                  <div>
                    <span>Provider</span>
                    <strong>{summary.vault.provider}</strong>
                  </div>
                </div>
                <dl className="finance-review">
                  <div>
                    <dt>Deposited principal</dt>
                    <dd>
                      {summary.position.principal === null
                        ? "Unavailable"
                        : `${assetAmount(summary.position.principal, summary.assetDecimals)} USDC`}
                    </dd>
                  </div>
                  <div>
                    <dt>Gain / loss</dt>
                    <dd>
                      {summary.position.gain === null
                        ? "Unavailable"
                        : `${assetAmount(summary.position.gain, summary.assetDecimals)} USDC`}
                    </dd>
                  </div>
                </dl>
                <details className="vault-details">
                  <summary>Fees and vault details</summary>
                  <p>{summary.vault.fees}</p>
                  <p>
                    Available liquidity:{" "}
                    {assetAmount(
                      summary.vault.liquidity,
                      summary.assetDecimals,
                    )}{" "}
                    USDC
                  </p>
                  <a
                    className="text-button"
                    href={`https://explorer.arc.io/address/${summary.vault.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View vault contract{" "}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </details>
                <div
                  className="grow-actions"
                  role="group"
                  aria-label="Earn action"
                >
                  <button
                    className={`button ${!withdrawing ? "primary" : "secondary"}`}
                    aria-pressed={!withdrawing}
                    onClick={() => setWithdrawing(false)}
                  >
                    <ArrowDownToLine size={18} aria-hidden="true" /> Deposit
                  </button>
                  <button
                    className={`button ${withdrawing ? "primary" : "secondary"}`}
                    aria-pressed={withdrawing}
                    onClick={() => setWithdrawing(true)}
                  >
                    <ArrowUpFromLine size={18} aria-hidden="true" /> Withdraw
                  </button>
                </div>
              </section>
              <FinanceForm
                key={`${summary.vault.address}:${withdrawing}`}
                kind={withdrawing ? "earn-withdraw" : "earn-deposit"}
                capabilities={{ ...capabilities, earn: true }}
                accountId={accountId}
                requestSignIn={requestSignIn}
                earn={summary}
                onConfirmed={() => {
                  setRevision((n) => n + 1);
                  portfolio.refresh();
                }}
              />
              <section className="grow-info">
                <h2>How it works</h2>
                <p>
                  Your USDC is deposited into {summary.vault.name}, a lending
                  vault provided by {summary.vault.provider}. Vault shares track
                  your position; withdrawals return available USDC to your
                  wallet.
                </p>
              </section>
              <section className="grow-info grow-risk">
                <h2>Risks</h2>
                <p>
                  Returns change and are not guaranteed. Smart-contract failures
                  and losses in lending markets can reduce your position.
                  Withdrawals depend on available vault liquidity.
                </p>
              </section>
            </>
          )}
        </>
      ) : (
        <section aria-label="USDC vaults">
          <Investments
            accountId={accountId}
            initialVaults={vaults}
            initialOpen={lastSelected.current}
            overview={portfolio.data}
            busy={portfolio.busy}
            error={portfolio.error}
            retry={portfolio.refresh}
            onSelect={(vault) => {
              selectionSource.current = "deck";
              setWithdrawing(false);
              setSelected(vault);
            }}
          />
          <h2 id="vault-discovery" className="vault-discovery-title">
            Explore vaults
          </h2>
          <label className="vault-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search vaults"
              placeholder="Search vaults"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="vault-list-heading">
            <span>Vault / provider</span>
            <span>Variable APY</span>
          </div>
          <p
            className="vault-results"
            ref={results}
            tabIndex={-1}
            role="status"
          >
            {vaults
              ? `${visible.length} ${visible.length === 1 ? "vault" : "vaults"}${search ? " matched" : " available"}`
              : ""}
          </p>
          {vaultError && (
            <p className="error" role="alert">
              {vaultError}
              <button
                className="text-button"
                disabled={vaultBusy}
                onClick={() => void loadVaults(vaults ? vaults.page + 1 : 1)}
              >
                Retry
              </button>
            </p>
          )}
          <ul className="earn-vault-list" aria-busy={vaultBusy}>
            {visible.map((vault) => (
              <li key={vault.address}>
                <button
                  className="vault-row"
                  id={`vault-${vault.address.toLowerCase()}`}
                  onClick={() => {
                    selectionSource.current = "discovery";
                    setWithdrawing(false);
                    setSelected(vault);
                  }}
                >
                  <img src="/tokens/usdc.svg" width="36" height="36" alt="" />
                  <span className="vault-row-name">
                    <strong>{vault.name}</strong>
                    <span>{vault.provider}</span>
                  </span>
                  <span className="vault-row-apy">{percent(vault.apy)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {vaultBusy && <Spinner label="Loading USDC vaults" />}
          {vaults?.hasMore && (
            <button
              className="button secondary"
              disabled={vaultBusy}
              onClick={() => void loadVaults(vaults.page + 1)}
            >
              More vaults
            </button>
          )}
          {!vaultBusy && !vaultError && vaults && !visible.length && (
            <p>
              {search
                ? "No vaults match your search."
                : "No USDC vaults are available."}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
