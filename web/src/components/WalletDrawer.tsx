import { lazy, Suspense, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Spinner } from "./Spinner";

const WalletActions = lazy(() =>
  import("./WalletActions").then((m) => ({ default: m.WalletActions })),
);

export function WalletDrawer({
  action,
  accountId,
  signedIn,
  requestSignIn,
  onClose,
  onConfirmed,
}: {
  action: "send" | "receive";
  accountId: string;
  signedIn: boolean;
  requestSignIn: () => void;
  onClose: () => void;
  onConfirmed?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const scroll = document.querySelector<HTMLElement>(".phone-scroll");
    const overflow = scroll?.style.overflow;
    if (scroll) scroll.style.overflow = "hidden";
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
      if (scroll) scroll.style.overflow = overflow ?? "";
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="wallet-drawer"
      aria-labelledby="wallet-drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="wallet-drawer-handle" aria-hidden="true" />
      <header className="wallet-drawer-header">
        <h2 id="wallet-drawer-title">
          {action === "send" ? "Send USDC" : "Receive USDC"}
        </h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={`Close ${action}`}
          autoFocus
        >
          <X size={22} />
        </button>
      </header>
      <div className="wallet-drawer-body">
        <Suspense fallback={<Spinner label={`Opening ${action}`} />}>
          <WalletActions
            key={`${action}:${accountId}`}
            action={action}
            signedIn={signedIn}
            requestSignIn={requestSignIn}
            onConfirmed={onConfirmed}
          />
        </Suspense>
      </div>
    </dialog>
  );
}
