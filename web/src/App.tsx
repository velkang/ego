import { lazy, Suspense, useEffect, useState } from "react";
import { authClient } from "./lib/auth";
import { api } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { AuthDialog } from "./components/AuthDialog";
import { Icon } from "./components/Icon";
const HomePage = lazy(() =>
  import("./pages/HomePage").then((module) => ({ default: module.HomePage })),
);
const EventPage = lazy(() =>
  import("./pages/EventPage").then((module) => ({ default: module.EventPage })),
);
const WalletPage = lazy(() =>
  import("./pages/WalletPage").then((module) => ({
    default: module.WalletPage,
  })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })),
);
export function App() {
  const path = useRoute(),
    { data: session } = authClient.useSession();
  const [showAuth, setShowAuth] = useState(false),
    [operator, setOperator] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [immersive, setImmersive] = useState(false);
  useEffect(() => {
    let alive = true;
    if (session)
      void api<{ operator: boolean }>("/me")
        .then((data) => {
          if (alive) setOperator(data.operator);
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
  useEffect(() => setImmersive(false), [path]);
  const eventRef = /^\/events\/([a-z0-9-]+)$/.exec(path)?.[1];
  const mapView = path === "/" || !!eventRef;
  return (
    <div
      className={`app-shell ${mapView ? "map-mode" : ""} ${immersive ? "immersive" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {!immersive && !eventRef && (
        <header className="site-header">
          <div className="header-inner">
            <a
              className="brand"
              href="/"
              aria-label="Jovva home"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <svg
                viewBox="0 0 34 34"
                width="34"
                height="34"
                aria-hidden="true"
              >
                <rect width="34" height="34" rx="11" fill="currentColor" />
                <path
                  d="M22 10v9c0 6-9 7-11 2m6-11h5"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              jovva<span className="brand-dot">.</span>
            </a>
            <div className="header-account">
              {operator && (
                <a
                  className="team-link"
                  href="/admin"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/admin");
                  }}
                >
                  Team
                </a>
              )}
              {session ? (
                <button
                  className="account-button"
                  onClick={() => {
                    void authClient.signOut();
                  }}
                  aria-label={`Sign out ${session.user.email}`}
                >
                  {session.user.email.slice(0, 1).toUpperCase()}
                </button>
              ) : (
                <button
                  className="button secondary sign-in-button"
                  onClick={() => setShowAuth(true)}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>
      )}
      {!online && (
        <div className="offline-notice" role="status">
          You’re offline. Reconnect to see live drops and claim rewards.
        </div>
      )}
      <div id="main-content" tabIndex={-1}>
        <Suspense
          fallback={
            <main className="page loading" role="status">
              Loading…
            </main>
          }
        >
          {path === "/" ? (
            <HomePage />
          ) : eventRef ? (
            <EventPage
              key={eventRef}
              id={eventRef}
              signedIn={!!session}
              requestSignIn={() => setShowAuth(true)}
              onHuntChange={setImmersive}
            />
          ) : path === "/wallet" ? (
            <WalletPage
              signedIn={!!session}
              requestSignIn={() => setShowAuth(true)}
            />
          ) : path === "/admin" && operator ? (
            <AdminPage />
          ) : (
            <main className="page">
              <div className="empty-state">
                <h1>
                  {path === "/admin" ? "Team access only." : "Page not found."}
                </h1>
                <p>
                  {path === "/admin"
                    ? "Sign in with an approved operator account."
                    : "This page couldn’t be found."}
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    path === "/admin" ? setShowAuth(true) : navigate("/")
                  }
                >
                  {path === "/admin" ? "Sign in" : "Explore events"}
                </button>
              </div>
            </main>
          )}
        </Suspense>
      </div>
      {!immersive && (
        <nav className="floating-nav" aria-label="Main navigation">
          <a
            href="/"
            className={mapView ? "active" : ""}
            aria-current={mapView ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <Icon name="compass" size={22} />
            <span>Explore</span>
          </a>
          <a
            href="/wallet"
            className={path === "/wallet" ? "active" : ""}
            aria-current={path === "/wallet" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate("/wallet");
            }}
          >
            <Icon name="wallet" size={22} />
            <span>Wallet</span>
          </a>
        </nav>
      )}
      {showAuth && (
        <AuthDialog
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            void authClient.getSession();
          }}
        />
      )}
    </div>
  );
}
