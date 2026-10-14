import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Coin } from "./Coin";
import { Spinner } from "./Spinner";
export function HoldButton({
  disabled = false,
  busy = false,
  onComplete,
  children,
  variant = "bar",
}: {
  disabled?: boolean;
  busy?: boolean;
  onComplete: () => void;
  children: ReactNode;
  variant?: "ring" | "bar";
}) {
  const frame = useRef(0),
    started = useRef<number | null>(null),
    [progress, setProgress] = useState(0),
    callback = useRef(onComplete);
  callback.current = onComplete;
  const cancel = () => {
    cancelAnimationFrame(frame.current);
    started.current = null;
    setProgress(0);
  };
  const start = () => {
    if (disabled || busy || started.current !== null) return;
    started.current = performance.now();
    const tick = (now: number) => {
      if (started.current === null) return;
      const p = Math.min(1, (now - started.current) / 1200);
      setProgress(p);
      if (p === 1) {
        started.current = null;
        callback.current();
      } else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);
  useEffect(() => {
    if (disabled || busy) cancel();
  }, [disabled, busy]);
  const button = (
    <button
      className={
        variant === "ring"
          ? `hold-ring ${busy ? "busy" : ""}`
          : "button primary hold-button"
      }
      style={{ "--progress": progress } as CSSProperties}
      disabled={disabled || busy}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          cancel();
        }
      }}
      onClick={(e) => {
        if (e.detail === 0 && !disabled && !busy) {
          cancel();
          callback.current();
        }
      }}
      aria-label={busy ? "Submitting claim" : "Claim reward"}
      aria-description="Hold the pointer, Space, or Enter for 1.2 seconds. Assistive activation also confirms your claim."
    >
      {variant === "ring" ? (
        <>
          <svg viewBox="0 0 92 92" aria-hidden="true">
            <circle
              className="track"
              cx="46"
              cy="46"
              r="42"
              strokeWidth="4"
              fill="none"
            />
            <circle
              className="bar"
              cx="46"
              cy="46"
              r="42"
              strokeWidth="4"
              fill="none"
              strokeDasharray={264}
              strokeDashoffset={264 * (1 - progress)}
            />
          </svg>
          <span className="hold-ring-core">
            <Coin small />
          </span>
        </>
      ) : (
        <span>
          {busy ? <Spinner inline label="Claiming reward" /> : children}
        </span>
      )}
    </button>
  );
  return variant === "ring" ? (
    <div className="hold-ring-wrap">
      {button}
      <span className="hold-ring-label">
        {busy ? <Spinner inline label="Claiming reward" /> : children}
      </span>
    </div>
  ) : (
    button
  );
}
