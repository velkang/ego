import { useId, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "../lib/auth";
import { Spinner } from "./Spinner";

export function AccountMenu({ email }: { email: string }) {
  const id = useId();
  const dropdown = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Couldn’t sign out. Try again.");
      dropdown.current?.hidePopover();
    } catch {
      setError("Couldn’t sign out. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="account-button"
        aria-label={`Account: ${email}`}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (dropdown.current) {
            dropdown.current.style.top = `${box.bottom + 8}px`;
            dropdown.current.style.right = `${Math.max(12, window.innerWidth - box.right)}px`;
          }
        }}
      >
        {email[0].toUpperCase()}
      </button>
      <div
        id={id}
        ref={dropdown}
        className="account-dropdown"
        popover="auto"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <p className="account-email">{email}</p>
        <button
          className="account-sign-out"
          type="button"
          disabled={busy}
          onClick={() => void signOut()}
        >
          {busy ? <Spinner inline label="Signing out" /> : <LogOut size={18} />}
          Sign out
        </button>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
