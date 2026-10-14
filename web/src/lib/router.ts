import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

function transition(update: () => void, kind: "tab" | "rise" | "back") {
  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.documentElement.dataset.navigation = kind;
  document
    .startViewTransition(() => flushSync(update))
    .finished.catch(() => {});
}
export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = (event: PopStateEvent) => {
      const update = () => setPath(window.location.pathname);
      if (event.isTrusted) transition(update, "back");
      else update();
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  return path;
}
export function navigate(path: string, replace = false) {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  const update = () => {
    if (replace) history.replaceState({}, "", path);
    else history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  // Wallet drawers keep the same page mounted and use their own sheet motion.
  if (
    replace ||
    path.startsWith("/wallet/") ||
    window.location?.pathname.startsWith("/wallet/")
  )
    update();
  else
    transition(
      update,
      ["/", "/apps", "/activity"].includes(path) ? "tab" : "rise",
    );
}
