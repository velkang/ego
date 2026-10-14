import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import { assetAmount, type EarnSummary, type EarnVaultList } from "@ego/chain";
import { useFinanceCapabilities } from "../lib/finance";
import { api } from "../lib/api";
import { FinanceForm } from "../components/FinanceForm";
import { Spinner } from "../components/Spinner";

type Vault = EarnVaultList["vaults"][number];
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
  const [selected, setSelected] = useState<Vault | null>(null);
  const [summary, setSummary] = useState<EarnSummary | null>(null);
  const [error, setError] = useState(""),
    [vaultError, setVaultError] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false),
    [withdrawing, setWithdrawing] = useState(false);
  const [search, setSearch] = useState(""),
    [revision, setRevision] = useState(0);
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
      const result = await api<EarnVaultList>(`/earn/vaults?page=${page}`);
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
    } else if (lastSelected.current)
      document.getElementById(`vault-${lastSelected.current}`)?.focus();
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
          onClick={() => setSelected(null)}
        >
          <ArrowLeft size={18} aria-hidden="true" /> All vaults
        </button>
      )}
      <header className="page-heading">
        <h1 ref={heading} tabIndex={-1}>
          {earning ? selected?.name || "Earn" : "Swap"}
        </h1>
        <p>
          {earning
            ? selected
              ? selected.provider
              : "Explore USDC lending vaults. Returns vary."
            : "Exchange assets in your wallet."}
        </p>
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
                className="earn-position"
                aria-label="Your vault position"
              >
                <div className="vault-overview">
                  <span>Variable APY</span>
                  <strong>{percent(summary.vault.apy)}</strong>
                </div>
                <dl className="finance-review">
                  <div>
                    <dt>Your position</dt>
                    <dd>
                      {assetAmount(
                        summary.position.value,
                        summary.assetDecimals,
                      )}{" "}
                      USDC
                    </dd>
                  </div>
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
                  className="vault-actions"
                  role="group"
                  aria-label="Earn action"
                >
                  <button
                    aria-pressed={!withdrawing}
                    onClick={() => setWithdrawing(false)}
                  >
                    Deposit
                  </button>
                  <button
                    aria-pressed={withdrawing}
                    onClick={() => setWithdrawing(true)}
                  >
                    Withdraw
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
                onConfirmed={() => setRevision((n) => n + 1)}
              />
            </>
          )}
        </>
      ) : (
        <section aria-label="USDC vaults">
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
