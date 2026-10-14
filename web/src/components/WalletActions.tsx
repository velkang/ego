import { FinanceForm } from "./FinanceForm";
import { useFinanceCapabilities } from "../lib/finance";
import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { explorerTransaction, formatUSDC } from "@ego/chain";
import { api, post, RequestError } from "../lib/api";
import { invalidateWallet } from "../lib/wallet";
import { QR } from "../components/QR";
import { Spinner } from "./Spinner";
type Transaction = {
  id: string;
  recipient: string;
  amount: number;
  status: string;
  transactionHash: string | null;
  fee: string;
};
export function WalletActions({
  action,
  signedIn,
  requestSignIn,
  onConfirmed,
  accountId,
}: {
  action: "send" | "receive";
  accountId: string;
  signedIn: boolean;
  requestSignIn: () => void;
  onConfirmed?: () => void;
}) {
  const capabilities = useFinanceCapabilities(signedIn, accountId);
  const [address, setAddress] = useState(""),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [quote, setQuote] = useState<{
      id: string;
      recipient: string;
      amount: number;
      fee: string;
      expiresAt: number;
    } | null>(null),
    [transaction, setTransaction] = useState<Transaction | null>(null),
    [history, setHistory] = useState<Transaction[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    if (signedIn) {
      void post<{ wallet: { address: string } }>("/wallet")
        .then((d) => {
          if (alive) setAddress(d.wallet.address);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
      if (action === "send")
        void api<{ transactions: Transaction[] }>("/wallet/transactions")
          .then((d) => {
            if (alive) setHistory(d.transactions);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
    }
    return () => {
      alive = false;
    };
  }, [signedIn, action]);
  useEffect(() => {
    if (transaction?.status === "confirmed") {
      invalidateWallet();
      onConfirmed?.();
    }
  }, [transaction?.id, transaction?.status]);
  useEffect(() => {
    if (!transaction || transaction.status !== "pending") return;
    let alive = true;
    const timer = setInterval(() => {
      void api<{ transaction: Transaction }>(
        `/wallet/transactions/${transaction.id}`,
      )
        .then((d) => {
          if (alive) setTransaction(d.transaction);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [transaction?.id, transaction?.status]);
  async function review() {
    setBusy(true);
    setError("");
    try {
      const units = decimalUnits(amount);
      const d = await post<{ quote: NonNullable<typeof quote> }>(
        "/wallet/send/quote",
        { recipient, amount: units },
      );
      setQuote(d.quote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      const d = await post<{ transaction: Transaction }>(
        `/wallet/send/${quote.id}`,
      );
      setTransaction(d.transaction);
      setQuote(null);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED")
        requestSignIn();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wallet-actions">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in
        </button>
      ) : action === "receive" ? (
        <section className="receive-panel">
          {address ? (
            <>
              <p>Send USDC on Arc to this address.</p>
              <QR value={address} label="Your receiving wallet address" />
              <p className="receive-address">{address}</p>
              <button
                className="button secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(address)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        "Copy failed. Select and copy the address above.",
                      ),
                    )
                }
              >
                <Copy size={18} />
                {copied ? "Copied" : "Copy address"}
              </button>
            </>
          ) : error ? null : (
            <Spinner label="Opening your wallet" />
          )}
        </section>
      ) : capabilities.loading ? (
        <Spinner label="Opening send" />
      ) : capabilities.withdraw || capabilities.swap ? (
        <FinanceForm
          kind="withdraw"
          accountId={accountId}
          capabilities={capabilities}
          requestSignIn={requestSignIn}
          onConfirmed={onConfirmed}
        />
      ) : transaction ? (
        <section className="send-success">
          <h2>
            {transaction.status === "confirmed"
              ? "Money sent"
              : transaction.status === "failed"
                ? "Send failed"
                : "Sending money"}
          </h2>
          <strong>{formatUSDC(transaction.amount)} USDC</strong>
          <p className="receive-address">{transaction.recipient}</p>
          <p role="status">
            {transaction.status === "pending"
              ? "Waiting for confirmation."
              : transaction.status === "failed"
                ? "The transfer could not complete."
                : "Transfer confirmed."}
          </p>
          {transaction.transactionHash && (
            <a
              className="text-button"
              href={explorerTransaction(transaction.transactionHash)}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
              <ExternalLink size={16} />
            </a>
          )}
          {transaction.status !== "pending" && (
            <button
              className="button secondary"
              onClick={() => {
                setTransaction(null);
                setAmount("");
              }}
            >
              Send another
            </button>
          )}
        </section>
      ) : quote ? (
        <section className="deposit-summary">
          <h2>Review transfer</h2>
          <strong>{formatUSDC(quote.amount)} USDC</strong>
          <p className="receive-address">{quote.recipient}</p>
          <p>Maximum network fee: {quote.fee} USDC</p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? (
              <Spinner inline label="Submitting transfer" />
            ) : (
              "Confirm send"
            )}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setQuote(null)}
          >
            Edit transfer
          </button>
        </section>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void review();
          }}
        >
          <label>
            Recipient address
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x…"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Amount in USDC
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Spinner inline label="Calculating fee" />
            ) : (
              "Review transfer"
            )}
          </button>
        </form>
      )}
      {action === "send" && history.length > 0 && (
        <section className="section">
          <h2>Recent transfers</h2>
          {history.map((t) => (
            <div className="history-row" key={t.id}>
              <span>
                {formatUSDC(t.amount)} · {t.status}
              </span>
              {t.status === "pending" ? (
                <button
                  className="text-button"
                  onClick={() => setTransaction(t)}
                >
                  Check status
                </button>
              ) : t.transactionHash ? (
                <a
                  className="text-button"
                  href={explorerTransaction(t.transactionHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Receipt
                </a>
              ) : null}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function decimalUnits(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim()))
    throw new Error("Enter a positive amount with up to six decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units < 1n || units > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("This amount is outside the supported range.");
  return Number(units);
}
