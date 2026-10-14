export function Amount({
  base,
  hidden = false,
}: {
  base: string;
  hidden?: boolean;
}) {
  const n = BigInt(base),
    whole = (n / 1000000n).toLocaleString("en-US"),
    dec = (n % 1000000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "")
      .padEnd(2, "0");
  return (
    <strong
      className="amount"
      style={whole.length + dec.length > 10 ? { fontSize: 28 } : undefined}
    >
      {hidden ? "••••" : whole}
      {!hidden && <span className="dec">.{dec}</span>}
      <span className="cur">USDC</span>
    </strong>
  );
}
