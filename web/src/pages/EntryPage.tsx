import { useEffect, useState } from "react";
import { Gift, Ticket, QrCode, Puzzle, Camera, ArrowLeft } from "lucide-react";
import { formatUSDC } from "@jovva/chain";
import { api, post } from "../lib/api";
import type { Claim, Event, Spot } from "../lib/types";
import { Link } from "../components/Link";
import { Coin, LargeCoin } from "../components/Coin";
import { ClaimReceipt } from "../components/ClaimReceipt";
import { Scanner } from "../components/Scanner";
type Prize = Spot & {
  campaign_title: string;
  slug: string;
  ends_at: number;
  status: string;
  claim_id: string | null;
  claim_status: string | null;
};
export function EntryPage({
  path,
  signedIn,
  requestSignIn,
  onHuntChange,
}: {
  path: string;
  signedIn: boolean;
  requestSignIn: () => void;
  onHuntChange: (active: boolean) => void;
}) {
  const kind = path === "/prizes" ? "prize" : path.split("/").at(-1),
    params = new URLSearchParams(location.search),
    fragment = new URLSearchParams(location.hash.slice(1));
  const [proof, setProof] = useState(fragment.get("proof") ?? ""),
    [eventRef, setEventRef] = useState(params.get("event") ?? ""),
    [event, setEvent] = useState<Event | null>(null),
    [spots, setSpots] = useState<Spot[]>([]),
    [selected, setSelected] = useState(fragment.get("spot") ?? ""),
    [prizes, setPrizes] = useState<Prize[]>([]),
    [claim, setClaim] = useState<Claim | null>(null),
    [venue, setVenue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [scanning, setScanning] = useState(false);
  useEffect(() => {
    onHuntChange(!!claim);
    return () => onHuntChange(false);
  }, [claim, onHuntChange]);
  const valid = ["prize", "code", "qr", "puzzle"].includes(kind ?? "");
  async function loadPrizes() {
    try {
      const d = await api<{ prizes: Prize[] }>("/prizes");
      setPrizes(d.prizes);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadPuzzle(ref = eventRef) {
    setBusy(true);
    setError("");
    try {
      let slug = ref.trim();
      try {
        slug = new URL(ref).pathname.split("/").at(-1) ?? slug;
      } catch {}
      const d = await api<{ event: Event; spots: Spot[] }>(
        `/events/${encodeURIComponent(slug)}`,
      );
      if (d.event.kind !== kind)
        throw new Error("This campaign uses a different claim method.");
      setEvent(d.event);
      setVenue(d.event.venue);
      setSpots(d.spots);
      setSelected((current) =>
        d.spots.some((s) => s.id === current)
          ? current
          : (d.spots[0]?.id ?? ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (kind === "prize" && signedIn) void loadPrizes();
    else if (eventRef) void loadPuzzle();
  }, [signedIn]);
  function scanned(value: string) {
    setScanning(false);
    try {
      const url = new URL(value);
      if (url.origin !== location.origin || !url.pathname.startsWith("/enter/"))
        throw new Error("invalid");
      const hash = new URLSearchParams(url.hash.slice(1));
      const p = hash.get("proof");
      if (!p) throw new Error("invalid");
      setProof(p);
      setSelected(hash.get("spot") ?? "");
      setEventRef(url.searchParams.get("event") ?? "");
    } catch {
      if (/^[a-z0-9]{32}$/i.test(value)) setProof(value);
      else setError("This QR code is not a Jovva claim link.");
    }
  }
  async function collect(spotId?: string, place?: string) {
    if (!signedIn) {
      requestSignIn();
      return;
    }
    setBusy(true);
    setError("");
    try {
      let id = spotId ?? selected;
      if (kind === "code" || kind === "qr") {
        let answer = proof.trim();
        try {
          const url = new URL(answer);
          const p = new URLSearchParams(url.hash.slice(1)).get("proof");
          if (p) answer = p;
        } catch {}
        const d = await post<{ drop: Spot & { campaign_title: string } }>(
          "/drops/resolve",
          { proof: answer },
        );
        id = d.drop.id;
        setVenue(d.drop.campaign_title);
        const result = await post<{ claim: Claim }>("/claims", {
          spotId: id,
          proof: answer,
        });
        setClaim(result.claim);
      } else {
        if (!id) throw new Error("Choose a reward first.");
        if (place) setVenue(place);
        const d = await post<{ claim: Claim }>("/claims", {
          spotId: id,
          proof: kind === "puzzle" ? proof : undefined,
        });
        setClaim(d.claim);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (claim)
    return (
      <ClaimReceipt
        initial={claim}
        venue={venue}
        onRetry={() => setClaim(null)}
        onContinue={
          kind === "prize" || event?.single_claim === 0
            ? () => {
                setClaim(null);
                setProof("");
                if (kind === "prize") void loadPrizes();
              }
            : undefined
        }
      />
    );
  return (
    <main className="page entry-page">
      <Link href="/" className="text-button">
        <ArrowLeft size={18} />
        Wallet
      </Link>
      <div className={kind === "prize" ? "prize-hero" : "page-heading"}>
        {kind === "prize" && <LargeCoin size={150} />}
        <div>
          <h1>
            {kind === "prize"
              ? "Your prizes"
              : kind === "qr"
                ? "Scan an event QR"
                : kind === "puzzle"
                  ? "Solve a puzzle"
                  : "Enter a code"}
          </h1>
          <p>
            {kind === "prize"
              ? "Rewards assigned to your verified email."
              : kind === "puzzle"
                ? "Find the answer and claim the reward."
                : "Use the code shared by the campaign creator."}
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!valid ? (
        <p>Unknown claim method.</p>
      ) : !signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in to claim
        </button>
      ) : kind === "prize" ? (
        <>
          <section className="prize-total">
            <span>Waiting for you</span>
            <strong className="amount">
              {formatUSDC(
                prizes
                  .filter((p) => !p.claim_status)
                  .reduce((sum, p) => sum + p.amount, 0),
              )}
            </strong>
            <span>USDC</span>
          </section>
          {prizes.length === 0 ? (
            <div className="empty-collection">
              <Gift size={40} />
              <h2>No prizes waiting yet</h2>
              <p>Prizes appear here when a funded campaign names your email.</p>
            </div>
          ) : (
            prizes.map((p) => (
              <section className="prize-card" key={p.id}>
                <div className="prize-card-top">
                  <Coin small />
                  <div>
                    <h2>{p.title}</h2>
                    <p>{p.campaign_title}</p>
                  </div>
                </div>
                <div className="prize-card-bottom">
                  <strong className="amount">{formatUSDC(p.amount)}</strong>
                  {p.claim_id ? (
                    <button
                      className="button secondary prize-claim"
                      onClick={() => {
                        void api<{ claim: Claim }>(`/claims/${p.claim_id}`)
                          .then((d) => {
                            setVenue(p.campaign_title);
                            setClaim(d.claim);
                          })
                          .catch((e) => setError(e.message));
                      }}
                    >
                      {p.claim_status === "confirmed"
                        ? "View receipt"
                        : "Check payout"}
                    </button>
                  ) : (
                    <button
                      className="button primary prize-claim"
                      disabled={
                        busy || p.remaining === 0 || p.status !== "active"
                      }
                      onClick={() => void collect(p.id, p.campaign_title)}
                    >
                      {p.remaining === 0
                        ? "Unavailable"
                        : p.status === "paused"
                          ? "Paused"
                          : "Claim"}
                    </button>
                  )}
                </div>
              </section>
            ))
          )}
          <button className="text-button" onClick={() => void loadPrizes()}>
            Refresh prizes
          </button>
        </>
      ) : (
        <>
          <div className="entry-tabs">
            {[
              { value: "code", icon: Ticket, title: "Code" },
              { value: "qr", icon: QrCode, title: "QR" },
              { value: "puzzle", icon: Puzzle, title: "Puzzle" },
            ].map(({ value, icon: Icon, title }) => (
              <Link
                key={value}
                href={`/enter/${value}`}
                aria-current={kind === value ? "page" : undefined}
              >
                <Icon size={20} />
                {title}
              </Link>
            ))}
          </div>
          {kind === "qr" &&
            (scanning ? (
              <Scanner onScan={scanned} onClose={() => setScanning(false)} />
            ) : (
              <button
                className="button secondary"
                onClick={() => setScanning(true)}
              >
                <Camera size={20} />
                Open camera
              </button>
            ))}
          {kind === "puzzle" && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void loadPuzzle();
              }}
            >
              <label>
                Campaign link or name
                <input
                  value={eventRef}
                  onChange={(e) => setEventRef(e.target.value)}
                  required
                  placeholder="garden-gathering"
                />
              </label>
              <button className="button secondary" disabled={busy}>
                Open puzzle
              </button>
            </form>
          )}
          {kind === "puzzle" && spots.length > 0 && (
            <section className="puzzle">
              <label>
                Puzzle
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {spots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {formatUSDC(s.amount)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="puzzle-clue">
                {spots.find((s) => s.id === selected)?.clue}
              </p>
            </section>
          )}
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void collect();
            }}
          >
            <label>
              {kind === "puzzle"
                ? "Your answer"
                : kind === "qr"
                  ? "QR link or code"
                  : "Your code"}
              <input
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              className="button primary"
              disabled={busy || (kind === "puzzle" && !selected)}
            >
              {busy ? "Claiming…" : "Claim reward"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
