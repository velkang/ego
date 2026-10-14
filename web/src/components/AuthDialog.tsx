import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/auth";
import { post } from "../lib/api";
import { Icon } from "./Icon";
import { Coin } from "./Coin";
import { Spinner } from "./Spinner";
export function AuthDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState(""),
    [otp, setOtp] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sentAt, setSentAt] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
    return () => {
      if (previous instanceof HTMLElement)
        previous.focus({ preventScroll: true });
    };
  }, []);
  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (result.error)
        throw new Error(
          result.error.message || "Couldn’t send your code. Try again.",
        );
      setSent(true);
      setSentAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.emailOtp({ email, otp });
      if (result.error)
        throw new Error(
          result.error.message || "That code didn’t work. Try again.",
        );
      try {
        await post("/wallet");
      } catch {
        /* Wallet provisioning can be retried from the wallet page. */
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="auth-dialog"
      onCancel={onClose}
      aria-labelledby="auth-title"
    >
      <button
        className="icon-button dialog-close"
        aria-label="Close sign-in"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      <Coin />
      <h2 id="auth-title">Sign in to Ego</h2>
      <p>Use your email to open your wallet and collect rewards.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (sent ? verify() : send());
        }}
      >
        {!sent ? (
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              autoFocus
            />
          </label>
        ) : (
          <>
            <p className="code-note">
              We sent a code to <strong>{email}</strong>.
            </p>
            <label>
              6-digit code
              <input
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required
                autoFocus
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <Spinner inline label={sent ? "Signing in" : "Sending code"} />
          ) : (
            <>
              {sent ? "Sign in" : "Send my code"}
              <Icon name="arrow" />
            </>
          )}
        </button>
        {sent && (
          <div className="form-secondary">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSent(false);
                setOtp("");
                setError("");
              }}
            >
              Change email
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (Date.now() - sentAt < 60000)
                  setError("Wait a minute before requesting another code.");
                else void send();
              }}
            >
              Resend code
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
