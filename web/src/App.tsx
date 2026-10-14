import { lazy, Suspense, useEffect, useState } from "react";
import { Coins, Compass, ArrowUpDown, Plus } from "lucide-react";
import { authClient } from "./lib/auth";
import { api } from "./lib/api";
import { invalidateWallet } from "./lib/wallet";
import { navigate, useRoute } from "./lib/router";
import { AuthDialog } from "./components/AuthDialog";
import { Link } from "./components/Link";
import { Spinner } from "./components/Spinner";
import { WalletDrawer } from "./components/WalletDrawer";
import { CreateSheet } from "./components/CreateSheet";
import { Onboarding } from "./components/Onboarding";
import { AccountMenu } from "./components/AccountMenu";
import { PageBoundary } from "./components/PageBoundary";
const AppsPage = lazy(() =>
  import("./pages/AppsPage").then((m) => ({ default: m.AppsPage })),
);
const ActivityPage = lazy(() =>
  import("./pages/ActivityPage").then((m) => ({ default: m.ActivityPage })),
);
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
const tabs = [
  { href: "/", label: "Home", icon: Coins },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/apps", label: "Apps", icon: Compass },
  { href: "/activity", label: "Activity", icon: ArrowUpDown },
];
export function App() {
  const path = useRoute(),
    { data: session } = authClient.useSession();
  const [walletAction, setWalletAction] = useState<"send" | "receive" | null>(
    null,
  );
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
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
    if (["/wallet", "/wallet/send", "/wallet/receive"].includes(path))
      navigate("/", true);
    if (path === "/map") navigate("/explore", true);
    setImmersive(false);
    document.querySelector(".phone-scroll")?.scrollTo(0, 0);
  }, [path]);
  useEffect(() => {
    setWalletAction(null);
  }, [path, session?.user.id]);
  useEffect(() => {
    if (!session) invalidateWallet();
  }, [session?.user.id]);
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
            <header
              className="topbar"
              style={{ viewTransitionName: "ego-topbar" }}
            >
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
                  <AccountMenu
                    key={session.user.id}
                    email={session.user.email}
                  />
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
            style={{
              viewTransitionName: "ego-page",
              ...(mapView || immersive ? { height: "100%" } : {}),
            }}
          >
            <PageBoundary key={path}>
              <Suspense fallback={<Spinner label="Loading page" full />}>
                {["/", "/wallet", "/wallet/send", "/wallet/receive"].includes(
                  path,
                ) ? (
                  <WalletPage
                    key={session?.user.id ?? "guest"}
                    accountId={session?.user.id ?? "guest"}
                    refreshKey={walletRefresh}
                    onAction={setWalletAction}
                    onCreate={() => setCreating(true)}
                    {...authProps}
                  />
                ) : path === "/apps" ? (
                  <AppsPage />
                ) : path === "/activity" ? (
                  <ActivityPage
                    key={session?.user.id ?? "guest"}
                    accountId={session?.user.id ?? "guest"}
                    {...authProps}
                  />
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
                ) : path === "/admin" && operator ? (
                  <AdminPage />
                ) : (
                  <main className="page">
                    <h1>
                      {path === "/admin"
                        ? "Team access only"
                        : "Page not found"}
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
            </PageBoundary>
          </div>
        </div>
        {!immersive && (
          <nav
            className="tabbar"
            aria-label="Main navigation"
            style={{ viewTransitionName: "ego-tabbar" }}
          >
            {tabs.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? path === "/" || path.startsWith("/wallet")
                  : href === "/apps"
                    ? path === "/apps" ||
                      mapView ||
                      path === "/prizes" ||
                      path.startsWith("/enter/")
                    : href === "/activity"
                      ? path === "/activity"
                      : ["/create", "/hide", "/pay"].includes(path);
              if (href === "/create")
                return (
                  <button
                    key={href}
                    className={active ? "active" : ""}
                    onClick={() => setCreating(true)}
                    aria-label="Create"
                    aria-haspopup="dialog"
                    aria-expanded={creating}
                  >
                    <Plus size={21} strokeWidth={active ? 2.4 : 2} />
                    <span>Create</span>
                  </button>
                );
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
        {walletAction && (
          <WalletDrawer
            action={walletAction}
            accountId={session?.user.id ?? "guest"}
            {...authProps}
            onClose={() => setWalletAction(null)}
            onConfirmed={() => setWalletRefresh((value) => value + 1)}
          />
        )}
        {creating && <CreateSheet onClose={() => setCreating(false)} />}
        {path === "/" && !showAuth && !creating && !walletAction && (
          <Onboarding
            signedIn={!!session}
            requestSignIn={() => setShowAuth(true)}
          />
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
