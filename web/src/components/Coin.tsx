export function Coin({ small = false }: { small?: boolean }) {
  return (
    <span className={`coin ${small ? "coin-small" : ""}`} aria-hidden="true">
      <span>
        J<span className="coin-dash" />
      </span>
    </span>
  );
}
