import { useEffect, useRef, useState } from "react";
import { ExternalLink, ArrowDownUp, ChevronDown, Bitcoin } from "lucide-react";
import {
  assetAmount,
  assetDefinition,
  assetUnits,
  type AssetSymbol,
  type EarnSummary,
  type FinanceCapabilities,
  type FinanceKind,
  type FinanceOperation,
  type FinanceQuote,
} from "@ego/chain";
import { api, post, RequestError } from "../lib/api";
import {
  readWallet,
  invalidateWallet,
  type WalletSnapshot,
} from "../lib/wallet";
import { Spinner } from "./Spinner";
import { invalidateEarn } from "../lib/earn";
export function FinanceForm({
  kind,
  capabilities,
  requestSignIn,
  onConfirmed,
  earn,
  accountId,
}: {
  kind: FinanceKind;
  accountId: string;
  capabilities: FinanceCapabilities;
  requestSignIn: () => void;
  onConfirmed?: () => void;
  earn?: EarnSummary;
}) {
  const [asset, setAsset] = useState<AssetSymbol>(
      kind === "swap" ? capabilities.swapPairs[0]?.from || "USDC" : "USDC",
    ),
    [output, setOutput] = useState<AssetSymbol>(
      capabilities.swapPairs[0]?.to || "EURC",
    );
  const [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [destination, setDestination] = useState("Arc"),
    [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<FinanceQuote | null>(null),
    [operation, setOperation] = useState<FinanceOperation | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [recovering, setRecovering] = useState(true),
    [pollStopped, setPollStopped] = useState(false),
    [pollRevision, setPollRevision] = useState(0);
  const focusTarget = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [clock, setClock] = useState(Date.now());
  const generation = useRef(0),
    notified = useRef("");
  const routes = capabilities.destinations.filter((d) =>
    d.assets.includes(asset),
  );
  const canUse =
    kind === "withdraw" ||
    (kind === "swap" ? capabilities.swap : capabilities.earn);
  const title =
    kind === "withdraw"
      ? "Send"
      : kind === "swap"
        ? "Swap"
        : kind === "earn-deposit"
          ? "Deposit"
          : "Withdraw";
  useEffect(() => {
    const current = ++generation.current;
    void readWallet(accountId)
      .then((data) => {
        if (generation.current === current) setWallet(data);
      })
      .catch(() => {});
    void api<{ operations: FinanceOperation[] }>("/finance/operations")
      .then((data) => {
        if (generation.current === current)
          setOperation(
            data.operations.find(
              (op) =>
                op.kind === kind &&
                op.status === "pending" &&
                (!kind.startsWith("earn-") ||
                  op.vaultAddress?.toLowerCase() ===
                    earn?.vault.address.toLowerCase()),
            ) || null,
          );
      })
      .catch(() => {})
      .finally(() => {
        if (generation.current === current) setRecovering(false);
      });
    return () => {
      generation.current++;
    };
  }, [kind, accountId]);
  useEffect(() => {
    if (quote || operation) focusTarget.current?.focus();
    else if (!recovering)
      form.current?.querySelector<HTMLElement>("select,input")?.focus();
  }, [quote?.id, operation?.id, operation?.status, recovering]);
  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote?.id]);
  useEffect(() => {
    if (operation?.status !== "pending") return;
    let active = true,
      running = false,
      failures = 0,
      timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    setPollStopped(false);
    const schedule = () => {
      timer = setTimeout(poll, Math.min(60_000, 4000 * 2 ** failures));
    };
    const poll = async () => {
      if (!active) return;
      if (Date.now() - started > 10 * 60_000) {
        setPollStopped(true);
        return;
      }
      if (running || document.hidden || !navigator.onLine) {
        schedule();
        return;
      }
      running = true;
      try {
        const data = await api<{ operation: FinanceOperation }>(
          `/finance/operations/${operation.id}`,
        );
        if (active) setOperation(data.operation);
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
  }, [operation?.id, operation?.status, pollRevision]);
  useEffect(() => {
    if (
      operation?.status === "confirmed" &&
      notified.current !== operation.id
    ) {
      notified.current = operation.id;
      invalidateWallet();
      if (kind.startsWith("earn-")) invalidateEarn();
      const current = generation.current;
      void readWallet(accountId)
        .then((data) => {
          if (generation.current === current) setWallet(data);
        })
        .catch(() => {});
      onConfirmed?.();
    }
  }, [operation?.id, operation?.status]);
  async function review(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const units = assetUnits(amount, assetDefinition(asset).decimals);
      if (BigInt(units) <= 0n)
        throw new Error("Enter an amount greater than zero.");
      const data = await post<{ quote: FinanceQuote }>("/finance/quotes", {
        kind,
        asset,
        amount: units,
        ...(kind.startsWith("earn-")
          ? { vaultAddress: earn?.vault.address }
          : {}),
        ...(kind === "swap"
          ? {
              outputAsset: output,
              slippageBps: Math.round(Number(slippage) * 100),
            }
          : {}),
        ...(kind === "withdraw"
          ? { destination, recipient: recipient.trim() }
          : {}),
      });
      if (generation.current === current) {
        setQuote(data.quote);
        setClock(Date.now());
      }
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function submit() {
    if (!quote) return;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const data = await post<{ operation: FinanceOperation }>(
        `/finance/quotes/${quote.id}/submit`,
      );
      if (generation.current === current) {
        setOperation(data.operation);
        setQuote(null);
      }
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED")
        requestSignIn();
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  const balance = wallet?.assets?.find((a) => a.symbol === asset);
  const availableUnits =
    balance?.units ?? (asset === "USDC" ? wallet?.balanceUnits : null);
  if (recovering) return <Spinner label="Checking pending transactions" />;
  if (!canUse)
    return <p role="status">This feature is currently unavailable.</p>;
  return (
    <div className="finance-flow">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {operation ? (
        <section aria-label="Transaction status">
          <h2 ref={focusTarget} tabIndex={-1} aria-live="polite">
            {operation.status === "confirmed"
              ? `${title} confirmed`
              : operation.status === "pending"
                ? `${title} in progress`
                : operation.status === "needs-review"
                  ? "Review required"
                  : `${title} failed`}
          </h2>
          <p>
            {assetAmount(
              operation.amount,
              assetDefinition(operation.asset).decimals,
            )}{" "}
            {operation.asset}
          </p>
          {operation.recipient && (
            <p className="finance-address">
              To {operation.recipient} on {operation.destination}
            </p>
          )}
          {operation.received && (
            <p>
              Received{" "}
              {assetAmount(
                operation.received.units,
                operation.received.decimals,
              )}{" "}
              {operation.received.symbol}
            </p>
          )}
          {operation.status === "confirmed" &&
            !operation.received &&
            operation.destination !== "Arc" && (
              <p>
                Minimum delivery:{" "}
                {assetAmount(
                  operation.minimumReceived,
                  operation.outputDecimals,
                )}{" "}
                {operation.outputAsset}
              </p>
            )}
          {operation.status === "pending" ? (
            <>
              <Spinner label="Waiting for confirmation" />
              <p role="status">
                You can close this screen. Follow the transfer in Activity.
              </p>
            </>
          ) : (
            operation.status !== "confirmed" && (
              <p role="status">
                {operation.status === "needs-review"
                  ? "Review a fresh quote before trying again. Completed approvals may have used network fees."
                  : "The transaction could not complete. Check its details before trying again."}
              </p>
            )
          )}
          {pollStopped && operation.status === "pending" && (
            <button
              className="button secondary"
              onClick={() => setPollRevision((n) => n + 1)}
            >
              Check status
            </button>
          )}
          {operation.transactions.map((tx) => (
            <a
              key={`${tx.phase}:${tx.hash}`}
              className="text-button finance-link"
              href={tx.url}
              target="_blank"
              rel="noreferrer"
            >
              {tx.phase} transaction <ExternalLink size={16} />
            </a>
          ))}
          {operation.status !== "pending" && (
            <button
              className="button secondary"
              onClick={() => {
                setOperation(null);
                setAmount("");
              }}
            >
              {operation.status === "confirmed" ? "Done" : "Review again"}
            </button>
          )}
        </section>
      ) : quote ? (
        <section aria-label="Review transaction">
          <h2 ref={focusTarget} tabIndex={-1}>
            Review {title.toLowerCase()}
          </h2>
          {kind === "swap" && (
            <div className="swap-box swap-review">
              <div className="swap-leg">
                <span>You pay</span>
                <div>
                  <output>
                    {assetAmount(quote.request.amount, quote.assetDecimals)}
                  </output>
                  <TokenPicker value={quote.request.asset} />
                </div>
              </div>
              <div className="swap-leg">
                <span>You get · estimated</span>
                <div>
                  <output>
                    {assetAmount(quote.estimatedReceived, quote.outputDecimals)}
                  </output>
                  <TokenPicker value={quote.outputAsset} />
                </div>
              </div>
            </div>
          )}
          <dl className="finance-review">
            {quote.vault && (
              <div>
                <dt>Vault</dt>
                <dd>
                  {quote.vault.name}
                  <small className="finance-address">
                    {quote.vault.address}
                  </small>
                </dd>
              </div>
            )}
            <div>
              <dt>Amount</dt>
              <dd>
                {assetAmount(
                  quote.request.amount,
                  assetDefinition(quote.request.asset).decimals,
                )}{" "}
                {quote.request.asset}
              </dd>
            </div>
            {quote.request.destination && (
              <div>
                <dt>Destination</dt>
                <dd>{quote.request.destination}</dd>
              </div>
            )}
            {quote.request.recipient && (
              <div>
                <dt>To</dt>
                <dd className="finance-address">{quote.request.recipient}</dd>
              </div>
            )}
            {kind === "swap" && (
              <div>
                <dt>Rate</dt>
                <dd>
                  1 {quote.request.asset} ≈{" "}
                  {assetAmount(
                    (
                      (BigInt(quote.estimatedReceived) *
                        10n **
                          BigInt(
                            assetDefinition(quote.request.asset).decimals,
                          )) /
                      BigInt(quote.request.amount)
                    ).toString(),
                    assetDefinition(quote.outputAsset).decimals,
                  )}{" "}
                  {quote.outputAsset}
                </dd>
              </div>
            )}
            <div>
              <dt>
                {kind === "earn-deposit"
                  ? "Deposit value"
                  : "Estimated receipt"}
              </dt>
              <dd>
                {assetAmount(quote.estimatedReceived, quote.outputDecimals)}{" "}
                {quote.outputAsset}
              </dd>
            </div>
            {kind === "swap" && (
              <div>
                <dt>Minimum received</dt>
                <dd>
                  {assetAmount(quote.minimumReceived, quote.outputDecimals)}{" "}
                  {quote.outputAsset}
                </dd>
              </div>
            )}
            {quote.fees.map((f, i) => (
              <div key={i}>
                <dt>{f.label}</dt>
                <dd>
                  {assetAmount(f.amount, f.decimals)} {f.symbol}
                </dd>
              </div>
            ))}
            <div>
              <dt>Maximum network fee</dt>
              <dd>
                {assetAmount(quote.networkFeeCap, quote.networkFeeDecimals)}{" "}
                USDC
              </dd>
            </div>
          </dl>
          <p>{quote.timing}</p>
          <p role="status">
            {clock >= quote.expiresAt
              ? "Quote expired. Go back to review again."
              : `Quote valid for ${Math.max(0, Math.ceil((quote.expiresAt - clock) / 1000))} seconds.`}
          </p>
          <div className="finance-buttons">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setQuote(null)}
            >
              Back
            </button>
            <button
              className="button primary"
              disabled={busy || clock >= quote.expiresAt}
              onClick={() => void submit()}
            >
              {busy ? (
                <Spinner label="Submitting" />
              ) : (
                `Confirm ${title.toLowerCase()}`
              )}
            </button>
          </div>
        </section>
      ) : (
        <form
          ref={form}
          className="finance-form"
          onSubmit={(e) => void review(e)}
        >
          <fieldset className="finance-fields" disabled={busy}>
            {kind === "swap" && (
              <div className="swap-box">
                <div className="swap-leg">
                  <label htmlFor="swap-pay-amount">You pay</label>
                  <div>
                    <input
                      id="swap-pay-amount"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                    />
                    <TokenPicker
                      value={asset}
                      label="Pay asset"
                      options={capabilities.assets
                        .filter((a) =>
                          capabilities.swapPairs.some(
                            (pair) => pair.from === a.symbol,
                          ),
                        )
                        .map((a) => a.symbol)}
                      onChange={(next) => {
                        setAsset(next);
                        if (
                          !capabilities.swapPairs.some(
                            (pair) => pair.from === next && pair.to === output,
                          )
                        )
                          setOutput(
                            capabilities.swapPairs.find(
                              (pair) => pair.from === next,
                            )!.to,
                          );
                      }}
                    />
                  </div>
                  <small>
                    Available:{" "}
                    {availableUnits == null
                      ? "Unavailable"
                      : `${assetAmount(availableUnits, assetDefinition(asset).decimals)} ${asset}`}
                  </small>
                </div>
                <button
                  type="button"
                  className="swap-flip"
                  aria-label="Swap direction"
                  disabled={
                    !capabilities.swapPairs.some(
                      (pair) => pair.from === output && pair.to === asset,
                    )
                  }
                  onClick={() => {
                    setAsset(output);
                    setOutput(asset);
                    setAmount("");
                  }}
                >
                  <ArrowDownUp size={18} aria-hidden="true" />
                </button>
                <div className="swap-leg">
                  <span>You get</span>
                  <div>
                    <output aria-label="Receive amount is calculated in the quote">
                      —
                    </output>
                    <TokenPicker
                      value={output}
                      label="Receive asset"
                      options={capabilities.swapPairs
                        .filter((pair) => pair.from === asset)
                        .map((pair) => pair.to)}
                      onChange={setOutput}
                    />
                  </div>
                  <small>Calculated in your quote.</small>
                </div>
              </div>
            )}
            {kind === "withdraw" && (
              <label>
                Asset
                <select
                  value={asset}
                  onChange={(e) => {
                    const next = e.target.value as AssetSymbol;
                    setAsset(next);
                    setDestination("Arc");
                  }}
                >
                  {capabilities.assets
                    .filter((a) => a.symbol !== "cirBTC")
                    .map((a) => (
                      <option key={a.symbol} value={a.symbol}>
                        {a.symbol}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {kind === "withdraw" && (
              <>
                <label>
                  Network
                  <select
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="Arc">Arc</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Receiving address
                  <input
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            {kind !== "swap" && (
              <>
                <label>
                  Amount ({asset})
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </label>
                <p>
                  Available:{" "}
                  {availableUnits == null
                    ? "Unavailable"
                    : `${assetAmount(availableUnits, assetDefinition(asset).decimals)} ${asset}`}
                  {asset !== "USDC"
                    ? " · Network fees are paid in USDC."
                    : " · Keep USDC available for network fees."}
                </p>
              </>
            )}
            {kind === "swap" && (
              <details className="swap-settings">
                <summary>
                  Slippage tolerance <span>{slippage || "—"}%</span>
                </summary>
                <label>
                  Slippage tolerance (%)
                  <input
                    type="number"
                    min="0.1"
                    max="3"
                    step="0.1"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    required
                  />
                </label>
                <p>
                  The minimum received in your quote includes this tolerance.
                </p>
              </details>
            )}
            {earn && (
              <p>
                {kind === "earn-withdraw"
                  ? `Current position: ${assetAmount(earn.position.value, earn.assetDecimals)} USDC. Withdrawal availability depends on vault liquidity.`
                  : "Returns are variable. Your deposited assets can lose value."}
              </p>
            )}
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? (
                <Spinner label="Getting quote" />
              ) : (
                `Review ${title.toLowerCase()}`
              )}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}

function TokenPicker({
  value,
  options,
  onChange,
  label,
}: {
  value: AssetSymbol;
  options?: AssetSymbol[];
  onChange?: (value: AssetSymbol) => void;
  label?: string;
}) {
  return (
    <span className={`swap-token${onChange ? " selectable" : ""}`}>
      {value === "cirBTC" ? (
        <Bitcoin size={24} aria-hidden="true" />
      ) : (
        <img
          src={`/tokens/${value.toLowerCase()}.svg`}
          width={24}
          height={24}
          alt=""
        />
      )}
      {onChange ? (
        <>
          <select
            value={value}
            onChange={(event) => onChange(event.target.value as AssetSymbol)}
            aria-label={label}
          >
            {options?.map((symbol) => (
              <option value={symbol} key={symbol}>
                {symbol}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </>
      ) : (
        <span>{value}</span>
      )}
    </span>
  );
}
