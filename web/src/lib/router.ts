import { useEffect, useState } from "react";
export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = () => {
      setPath(window.location.pathname);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  return path;
}
export function navigate(path: string, replace = false) {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
