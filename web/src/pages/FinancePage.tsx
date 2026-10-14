import { useEffect, useRef, useState } from "react";
import { assetAmount, type EarnSummary, type EarnVaultList } from "@ego/chain";
import { useFinanceCapabilities } from "../lib/finance";
import { api } from "../lib/api";
import { FinanceForm } from "../components/FinanceForm";
import { Spinner } from "../components/Spinner";
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
  const [summary, setSummary] = useState<EarnSummary | null>(null),
    [error, setError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false),
    [revision, setRevision] = useState(0);
  const earning = path === "/earn";
  const [vaults, setVaults] = useState<EarnVaultList | null>(null);
  const [vaultError, setVaultError] = useState(""),
    [vaultBusy, setVaultBusy] = useState(false);
  const vaultStatus = useRef<HTMLParagraphElement>(null);
  const focusVaultResults = useRef(false);
  useEffect(() => {
    if (focusVaultResults.current) {
      focusVaultResults.current = false;
      vaultStatus.current?.focus();
    }
  }, [vaults]);
  async function loadVaults(page = 1) {
    setVaultBusy(true);
    setVaultError("");
    try {
      const result = await api<EarnVaultList>(`/earn/vaults?page=${page}`);
      focusVaultResults.current = true;
      setVaults((previous) =>
        page === 1
          ? result
          : {
              ...result,
              vaults: [...(previous?.vaults || []), ...result.vaults],
            },
      );
    } catch (e) {
      setVaultError((e as Error).message);
    } finally {
      setVaultBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    if (earning && signedIn) {
      setVaults(null);
      setVaultBusy(true);
      setVaultError("");
      void api<EarnVaultList>("/earn/vaults?page=1")
        .then((result) => {
          if (active) setVaults(result);
        })
        .catch((e) => {
          if (active) setVaultError(e.message);
        })
        .finally(() => {
          if (active) setVaultBusy(false);
        });
    }
    return () => {
      active = false;
    };
  }, [earning, signedIn, accountId]);
  useEffect(() => {
    let active = true;
    if (earning && capabilities.earn) {
      setError("");
      void api<EarnSummary>("/earn")
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
  }, [earning, capabilities.earn, accountId, revision]);
  const available = earning ? capabilities.earnDiscovery : capabilities.swap;
  return (
    <main className="page finance-page">
      <header className="page-heading">
        <h1>{earning ? "Earn" : "Swap"}</h1>
        <p>
          {earning
            ? "Put USDC to work in a lending vault."
            : "Exchange assets in your wallet."}
        </p>
      </header>
      {!signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in
        </button>
      ) : capabilities.loading ? (
        <Spinner label="Opening wallet features" />
      ) : !available ? (
        <p role="status">
          {earning ? "Earn" : "Swaps"} is currently unavailable.
        </p>
      ) : (
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
          {earning &&
            capabilities.earn &&
            (summary ? (
              <section
                className="earn-position"
                aria-label="Vault and position"
              >
                <h2>{summary.vault.name}</h2>
                <p>{summary.vault.provider}</p>
                <dl className="finance-review">
                  <div>
                    <dt>Variable APY</dt>
                    <dd>{(summary.vault.apy * 100).toFixed(2)}%</dd>
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
                    <dt>Current value</dt>
                    <dd>
                      {assetAmount(
                        summary.position.value,
                        summary.assetDecimals,
                      )}{" "}
                      USDC
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
                  <div>
                    <dt>Available vault liquidity</dt>
                    <dd>
                      {assetAmount(
                        summary.vault.liquidity,
                        summary.assetDecimals,
                      )}{" "}
                      USDC
                    </dd>
                  </div>
                </dl>
                <p>{summary.vault.fees}</p>
                <div
                  className="finance-buttons"
                  role="group"
                  aria-label="Earn action"
                >
                  <button
                    className={`button ${!withdrawing ? "primary" : "secondary"}`}
                    aria-pressed={!withdrawing}
                    onClick={() => setWithdrawing(false)}
                  >
                    Deposit
                  </button>
                  <button
                    className={`button ${withdrawing ? "primary" : "secondary"}`}
                    aria-pressed={withdrawing}
                    onClick={() => setWithdrawing(true)}
                  >
                    Withdraw
                  </button>
                </div>
              </section>
            ) : (
              !error && <Spinner label="Loading your position" />
            ))}
          {(!earning || (capabilities.earn && summary)) && (
            <FinanceForm
              key={`${path}:${withdrawing}`}
              kind={
                earning
                  ? withdrawing
                    ? "earn-withdraw"
                    : "earn-deposit"
                  : "swap"
              }
              capabilities={capabilities}
              accountId={accountId}
              requestSignIn={requestSignIn}
              earn={summary || undefined}
              onConfirmed={() => setRevision((n) => n + 1)}
            />
          )}
          {earning && (
            <section aria-label="USDC vaults">
              <h2>USDC vaults</h2>
              <p>
                Variable returns. Deposits are available only for validated
                vaults.
              </p>
              {vaultError && (
                <p className="error" role="alert">
                  {vaultError}
                  <button
                    className="text-button"
                    onClick={() =>
                      void loadVaults(vaults ? vaults.page + 1 : 1)
                    }
                  >
                    Retry
                  </button>
                </p>
              )}
              <p ref={vaultStatus} tabIndex={-1} role="status">
                {vaults ? `${vaults.vaults.length} USDC vaults listed` : ""}
              </p>
              <ul className="earn-vault-list" aria-busy={vaultBusy}>
                {vaults?.vaults.map((vault) => (
                  <li key={vault.address}>
                    <h3>{vault.name}</h3>
                    <p>{vault.provider}</p>
                    <dl className="finance-review">
                      <div>
                        <dt>Variable APY</dt>
                        <dd>
                          {vault.apy === null
                            ? "Unavailable"
                            : `${(vault.apy * 100).toFixed(2)}%`}
                        </dd>
                      </div>
                      <div>
                        <dt>Performance fee</dt>
                        <dd>
                          {vault.performanceFee === null
                            ? "Unavailable"
                            : `${(vault.performanceFee * 100).toFixed(2)}% of returns`}
                        </dd>
                      </div>
                      <div>
                        <dt>Annual management fee</dt>
                        <dd>
                          {vault.managementFee === null
                            ? "Not specified"
                            : `${(vault.managementFee * 100).toFixed(2)}%`}
                        </dd>
                      </div>
                      <div>
                        <dt>Available liquidity</dt>
                        <dd>
                          {assetAmount(vault.liquidity, vault.decimals)} USDC
                        </dd>
                      </div>
                    </dl>
                    <a
                      className="text-button"
                      href={`https://explorer.arc.io/address/${vault.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View vault contract
                    </a>
                    <p>
                      {vault.enabled
                        ? "Deposits enabled"
                        : "Deposits unavailable"}
                    </p>
                  </li>
                ))}
              </ul>
              {vaultBusy && <Spinner label="Loading USDC vaults" />}
              {vaults?.hasMore ? (
                <button
                  className="button secondary"
                  disabled={vaultBusy}
                  onClick={() => void loadVaults(vaults.page + 1)}
                >
                  More vaults
                </button>
              ) : vaults && !vaults.vaults.length ? (
                <p>No USDC vaults are available.</p>
              ) : null}
            </section>
          )}
        </>
      )}
    </main>
  );
}
