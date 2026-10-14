import { useFinanceCapabilities } from "../lib/finance";
import {
  ArrowLeftRight,
  TrendingUp,
  Gift,
  Map,
  Puzzle,
  QrCode,
  Ticket,
} from "lucide-react";
import { Link } from "../components/Link";
const apps = [
  {
    href: "/explore",
    icon: Map,
    title: "Money Drops",
    sub: "Hunt USDC hidden nearby",
    tone: "blue",
    big: true,
  },
  {
    href: "/prizes",
    icon: Gift,
    title: "Prizes & bounties",
    sub: "Claim what you won",
    tone: "gold",
    big: true,
  },
  {
    href: "/enter/code",
    icon: Ticket,
    title: "Enter a code",
    sub: "Giveaways and posts",
    tone: "violet",
  },
  {
    href: "/enter/qr",
    icon: QrCode,
    title: "Event QR",
    sub: "Scan at the venue",
    tone: "green",
  },
  {
    href: "/enter/puzzle",
    icon: Puzzle,
    title: "Puzzles",
    sub: "Crack it, keep it",
    tone: "orange",
  },
];
export function AppsPage({
  signedIn,
  accountId,
}: {
  signedIn: boolean;
  accountId: string;
}) {
  const capabilities = useFinanceCapabilities(signedIn, accountId);
  const visibleApps = [
    ...apps,
    {
      href: "/swap",
      icon: ArrowLeftRight,
      title: "Swap",
      sub: "Exchange wallet assets",
      tone: "blue",
      big: false,
    },
    ...(capabilities.earnDiscovery
      ? [
          {
            href: "/earn",
            icon: TrendingUp,
            title: "Earn",
            sub: "Explore USDC lending",
            tone: "green",
            big: false,
          },
        ]
      : []),
  ];
  return (
    <main className="page apps-page">
      <header className="page-heading">
        <h1>Apps</h1>
        <p>Fun ways to get paid.</p>
      </header>
      <div className="app-grid">
        {visibleApps.map(({ href, icon: Icon, title, sub, tone, big }) => (
          <Link
            key={href}
            href={href}
            className={`app-tile tone-${tone} ${big ? "big" : ""}`}
          >
            <span className="app-icon">
              <Icon size={22} />
            </span>
            <strong>{title}</strong>
            <span>{sub}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
