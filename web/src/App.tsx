import { lazy, Suspense, useEffect, useState } from "react";
import { Wallet, Map, Gift, Plus } from "lucide-react";
import { authClient } from "./lib/auth";
import { api } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { AuthDialog } from "./components/AuthDialog";
import { Link } from "./components/Link";
const HomePage = lazy(() =>
  import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const WalletPage = lazy(() =>
  import("./pages/WalletPage").then((m) => ({ default: m.WalletPage })),
);
const EventPage = lazy(() =>
  import("./pages/EventPage").then((m) => ({ default: m.EventPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const CampaignPage = lazy(() =>
  import("./pages/CampaignPage").then((m) => ({ default: m.CampaignPage })),
);
const EntryPage = lazy(() =>
  import("./pages/EntryPage").then((m) => ({ default: m.EntryPage })),
);
const WalletActionPage = lazy(() =>
  import("./pages/WalletActionPage").then((m) => ({
    default: m.WalletActionPage,
  })),
);
const tabs = [
  { href: "/", label: "Wallet", icon: Wallet },
  { href: "/explore", label: "Explore", icon: Map },
  { href: "/prizes", label: "Prizes", icon: Gift },
  { href: "/create", label: "Create", icon: Plus },
];
export function App() {
  const path = useRoute(),
    { data: session } = authClient.useSession();
  const [showAuth, setShowAuth] = useState(false),
    [operator, setOperator] = useState(false),
    [immersive, setImmersive] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const authProps = {
    signedIn: !!session,
    requestSignIn: () => setShowAuth(true),
  };
  const eventRef = /^\/events\/([a-z0-9-]+)$/.exec(path)?.[1],
    mapView = path === "/explore" || !!eventRef;
  useEffect(() => {
    if (path === "/wallet") navigate("/", true);
    if (path === "/map") navigate("/explore", true);
    setImmersive(false);
    document.querySelector(".phone-scroll")?.scrollTo(0, 0);
  }, [path]);
  useEffect(() => {
    let alive = true;
    if (session)
      void api<{ operator: boolean }>("/me")
        .then((d) => {
          if (alive) setOperator(d.operator);
        })
        .catch(() => {
          if (alive) setOperator(false);
        });
    else setOperator(false);
    return () => {
      alive = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  return (
    <div className="app-stage">
      <div
        className={`phone app-shell ${mapView ? "map-mode" : ""} ${immersive ? "immersive" : ""}`}
      >
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className={`phone-scroll ${mapView || immersive ? "bleed" : ""}`}>
          {!mapView && !immersive && (
            <header className="topbar">
              <Link className="brand" href="/" aria-label="Ego home">
                ego
                <span className="brand-dot" />
              </Link>
              <div className="header-account">
                {operator && (
                  <Link href="/admin" className="text-button">
                    Team
                  </Link>
                )}
                {session ? (
                  <button
                    className="account-button"
                    aria-label={`Sign out ${session.user.email}`}
                    onClick={() => void authClient.signOut()}
                  >
                    {session.user.email[0].toUpperCase()}
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    onClick={() => setShowAuth(true)}
                  >
                    Sign in
                  </button>
                )}
              </div>
            </header>
          )}
          {!online && (
            <div className="offline-notice" role="status">
              You’re offline. Reconnect to see live drops and claim rewards.
            </div>
          )}
          <div
            id="main-content"
            tabIndex={-1}
            style={mapView || immersive ? { height: "100%" } : undefined}
          >
            <Suspense
              fallback={
                <main className="page" role="status">
                  Loading…
                </main>
              }
            >
              {path === "/" || path === "/wallet" ? (
                <WalletPage key={session?.user.id ?? "guest"} {...authProps} />
              ) : path === "/explore" || path === "/map" ? (
                <HomePage />
              ) : eventRef ? (
                <EventPage
                  key={`${eventRef}:${session?.user.id ?? "guest"}`}
                  id={eventRef}
                  {...authProps}
                  onHuntChange={setImmersive}
                />
              ) : ["/create", "/hide", "/pay"].includes(path) ? (
                <CampaignPage
                  key={`${path}:${session?.user.id ?? "guest"}`}
                  path={path}
                  {...authProps}
                />
              ) : path === "/prizes" || path.startsWith("/enter/") ? (
                <EntryPage
                  key={`${path}:${session?.user.id ?? "guest"}`}
                  path={path}
                  {...authProps}
                  onHuntChange={setImmersive}
                />
              ) : ["/wallet/send", "/wallet/receive"].includes(path) ? (
                <WalletActionPage
                  key={`${path}:${session?.user.id ?? "guest"}`}
                  action={path.endsWith("send") ? "send" : "receive"}
                  {...authProps}
                />
              ) : path === "/admin" && operator ? (
                <AdminPage />
              ) : (
                <main className="page">
                  <h1>
                    {path === "/admin" ? "Team access only" : "Page not found"}
                  </h1>
                  <button
                    className="button primary"
                    onClick={() =>
                      path === "/admin" ? setShowAuth(true) : navigate("/")
                    }
                  >
                    {path === "/admin" ? "Sign in" : "Go to wallet"}
                  </button>
                </main>
              )}
            </Suspense>
          </div>
        </div>
        {!immersive && (
          <nav className="tabbar" aria-label="Main navigation">
            {tabs.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? path === "/" || path.startsWith("/wallet")
                  : href === "/explore"
                    ? mapView
                    : href === "/prizes"
                      ? path === "/prizes" || path.startsWith("/enter/")
                      : ["/create", "/hide", "/pay"].includes(path);
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        )}
        {showAuth && (
          <AuthDialog
            onClose={() => setShowAuth(false)}
            onSuccess={() => void authClient.getSession()}
          />
        )}
      </div>
    </div>
  );
}
