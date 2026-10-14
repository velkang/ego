import type { CSSProperties } from "react";

// Each digit is a native CSS reel. Keep the underlying amount as BigInt so
// animation never rounds away micro-USDC or converts a large balance to Number.
export function RollingDigits({ value }: { value: string }) {
  return (
    <span className="rolling-digits" aria-hidden="true">
      {Array.from(value).map((char, index) =>
        /\d/.test(char) ? (
          <span className="rolling-column" key={value.length - index}>
            <span
              className="rolling-reel"
              style={{ "--digit": Number(char) } as CSSProperties}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={value.length - index}>{char}</span>
        ),
      )}
    </span>
  );
}
export function Amount({
  base,
  hidden = false,
  prefix = "",
  currency = "USDC",
}: {
  base: string;
  hidden?: boolean;
  prefix?: string;
  currency?: string;
}) {
  const n = BigInt(base);
  const whole = (n / 1000000n).toLocaleString("en-US");
  const dec = (n % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  const label = hidden
    ? "Balance hidden"
    : `${prefix}${whole}.${dec}${currency ? ` ${currency}` : ""}`;
  return (
    <strong
      className="amount"
      style={
        {
          "--amount-width": Math.max(
            4.5,
            (whole.length + dec.length + prefix.length + 1) * 0.68,
          ),
        } as CSSProperties
      }
    >
      <span className="sr-only">{label}</span>
      {hidden ? (
        <span aria-hidden="true">••••</span>
      ) : (
        <>
          <span aria-hidden="true">{prefix}</span>
          <RollingDigits value={whole} />
          <span className="dec" aria-hidden="true">
            .<RollingDigits value={dec} />
          </span>
          {currency && (
            <span className="cur" aria-hidden="true">
              {currency}
            </span>
          )}
        </>
      )}
    </strong>
  );
}
