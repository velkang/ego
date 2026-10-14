import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
const ThreeCoin = lazy(() => import("./Coin3D"));
export function Coin({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`coin ${small ? "coin-sm" : "coin-md"}`}
      aria-hidden="true"
    />
  );
}
class CoinBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function LargeCoin({
  size = 132,
  entrance = "none",
}: {
  size?: number;
  entrance?: "none" | "drop";
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const update = () => setAvailable(!!gl && !media.matches);
    update();
    media.addEventListener("change", update);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return () => media.removeEventListener("change", update);
  }, []);
  const fallback = (
    <img
      src="/coin/tilt.png"
      alt=""
      width={size}
      height={size}
      className="coin-still"
    />
  );
  return available ? (
    <CoinBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ThreeCoin size={size} entrance={entrance} />
      </Suspense>
    </CoinBoundary>
  ) : (
    fallback
  );
}
