import { useEffect, useState } from "react";
import {
  Plus,
  MapPin,
  Gift,
  Ticket,
  QrCode,
  Puzzle,
  ArrowLeft,
  Copy,
} from "lucide-react";
import { LargeCoin } from "../components/Coin";
import type { DropKind } from "@jovva/chain";
import { formatUSDC } from "@jovva/chain";
import { api, post, RequestError } from "../lib/api";
import { decimalUnits } from "./WalletActionPage";
import { Link } from "../components/Link";
import { QR } from "../components/QR";
import { PointPicker } from "../components/PointPicker";
import { freshLocation } from "../lib/location";
import type { Event, Operation } from "../lib/types";
type Kind = DropKind;
type DraftDrop = {
  title: string;
  amount: string;
  capacity: number;
  latitude: number;
  longitude: number;
  radius: number;
  answer: string;
  clue: string;
  email: string;
};
const newDrop = (): DraftDrop => ({
  title: "",
  amount: "5",
  capacity: 1,
  latitude: 6.4474,
  longitude: 3.3966,
  radius: 50,
  answer: "",
  clue: "",
  email: "",
});
const kinds = [
  { value: "map", title: "Money drops", icon: MapPin },
  { value: "code", title: "Codes", icon: Ticket },
  { value: "qr", title: "Event QR", icon: QrCode },
  { value: "puzzle", title: "Puzzles", icon: Puzzle },
  { value: "prize", title: "Pay winners", icon: Gift },
] as const;
export function CampaignPage({
  path,
  signedIn,
  requestSignIn,
}: {
  path: string;
  signedIn: boolean;
  requestSignIn: () => void;
}) {
  const [kind, setKind] = useState<Kind>(
      path === "/hide" ? "map" : path === "/pay" ? "prize" : "code",
    ),
    [title, setTitle] = useState(""),
    [venue, setVenue] = useState(""),
    [description, setDescription] = useState(""),
    [ends, setEnds] = useState(() =>
      new Date(
        Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16),
    ),
    [single, setSingle] = useState(true),
    [drops, setDrops] = useState<DraftDrop[]>([newDrop()]),
    [created, setCreated] = useState<{ id: string; slug: string } | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [operations, setOperations] = useState<Operation[]>([]),
    [secrets, setSecrets] = useState<
      {
        id: string;
        title: string;
        answer: string | null;
        clue: string;
        email: string | null;
      }[]
    >([]),
    [quote, setQuote] = useState<{
      id: string;
      amount: number;
      fee: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const d = await api<{ events: Event[]; operations: Operation[] }>(
        "/campaigns",
      );
      setEvents(d.events);
      setOperations(d.operations);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn || !operations.some((o) => o.status === "pending")) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [signedIn, operations]);
  function update(index: number, value: Partial<DraftDrop>) {
    setDrops((list) =>
      list.map((d, i) => (i === index ? { ...d, ...value } : d)),
    );
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      if (drops.some((d) => decimalUnits(d.amount) > 100_000_000))
        throw new Error("Each reward can be at most 100 USDC.");
      const spots = drops.map((d, i) => ({
        ...d,
        title:
          d.title.trim() || `${kind === "prize" ? "Prize" : "Drop"} ${i + 1}`,
        amount: decimalUnits(d.amount),
        capacity: kind === "prize" ? 1 : d.capacity,
      }));
      const result = await post<{ id: string; slug: string }>("/campaigns", {
        title,
        venue: venue.trim() || title,
        description,
        latitude: spots[0].latitude,
        longitude: spots[0].longitude,
        startsAt: Date.now(),
        endsAt: new Date(ends).getTime(),
        spots,
        kind,
        singleClaim: single,
        proofs:
          kind === "map"
            ? undefined
            : drops.map((d) => ({
                answer: kind === "puzzle" ? d.answer : undefined,
                clue: d.clue,
                email: kind === "prize" ? d.email : undefined,
              })),
      });
      setCreated(result);
      if (kind !== "map") {
        const d = await api<{ drops: typeof secrets }>(
          `/campaigns/${result.id}/secrets`,
        );
        setSecrets(d.drops);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, action: string) {
    setBusy(true);
    setError("");
    try {
      await post(`/campaigns/${id}/actions`, {
        action,
        quoteId: action === "launch" ? quote?.id : undefined,
      });
      setQuote(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED")
        requestSignIn();
    } finally {
      setBusy(false);
    }
  }
  async function review(id: string) {
    setBusy(true);
    setError("");
    try {
      const q = await post<NonNullable<typeof quote>>(`/campaigns/${id}/quote`);
      setQuote(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    setError("");
    try {
      await post(`/campaigns/${id}/retry`);
      await load();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED")
        requestSignIn();
    } finally {
      setBusy(false);
    }
  }
  async function share(event: Event) {
    setCreated({ id: event.id, slug: event.slug });
    setKind(event.kind ?? "map");
    setQuote(null);
    setSecrets([]);
    try {
      const d = await api<{ drops: typeof secrets }>(
        `/campaigns/${event.id}/secrets`,
      );
      setSecrets(d.drops);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const total = drops.reduce((sum, d) => {
    try {
      return sum + decimalUnits(d.amount) * (kind === "prize" ? 1 : d.capacity);
    } catch {
      return sum;
    }
  }, 0);
  const current = events.find((e) => e.id === created?.id);
  return (
    <main className="page create-page">
      <div className={kind === "prize" ? "prize-hero" : "page-heading"}>
        {kind === "prize" && <LargeCoin size={150} />}
        <div>
          <h1>
            {path === "/pay"
              ? "Pay winners"
              : path === "/hide"
                ? "Hide money"
                : "Create a giveaway"}
          </h1>
          <p>
            {path === "/pay"
              ? "Fund prizes. Winners claim with their verified email."
              : path === "/hide"
                ? "Choose the places, set the rewards, and fund your hunt."
                : "Make a code, an event QR, or a puzzle worth solving."}
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!signedIn ? (
        <button className="button primary" onClick={requestSignIn}>
          Sign in to create
        </button>
      ) : created ? (
        <>
          <section className="created-summary">
            <h2>{current?.title ?? "Campaign created"}</h2>
            <p>Status: {current?.status ?? "draft"}</p>
            <p>Rewards: {formatUSDC(current?.budget ?? total)} USDC</p>
            {operations
              .filter((o) => o.event_id === created.id)
              .slice(0, 1)
              .map((o) => (
                <p key={o.id} role="status">
                  {o.status === "complete"
                    ? "Confirmed"
                    : o.status === "failed"
                      ? "Funding or management failed"
                      : `Processing ${o.phase}…`}
                  {o.error && ` · ${o.error}`}
                </p>
              ))}
            {(!current || current.status === "draft") && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void review(created.id)}
              >
                Review funding
              </button>
            )}
            {quote && (
              <>
                <p>Maximum network fee: {quote.fee} USDC</p>
                <p>
                  The rewards will be held in escrow until collected or
                  refunded.
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void action(created.id, "launch")}
                >
                  {busy ? "Submitting…" : "Confirm funding"}
                </button>
              </>
            )}
            {current?.status === "active" && (
              <Link
                href={`/events/${created.slug}`}
                className="button secondary"
              >
                Open campaign
              </Link>
            )}
            <button
              className="text-button"
              onClick={() => {
                setCreated(null);
                setQuote(null);
                setSecrets([]);
              }}
            >
              Create another
            </button>
          </section>
          {secrets.length > 0 && (
            <section className="share-drops">
              <h2>Share your drops</h2>
              {secrets.map((d) => {
                const url = `${location.origin}/enter/${kind}?event=${created.slug}#spot=${d.id}${kind === "qr" && d.answer ? `&proof=${encodeURIComponent(d.answer)}` : ""}`;
                return (
                  <div className="share-drop" key={d.id}>
                    <strong>{d.title}</strong>
                    {d.email ? (
                      <p>
                        Assigned to {d.email}. Winners sign in and open Prizes.
                      </p>
                    ) : (
                      <>
                        {kind === "qr" && (
                          <QR
                            value={url}
                            label={`Claim QR code for ${d.title}`}
                          />
                        )}
                        <p className="share-url">{url}</p>
                        {d.answer && (
                          <p className="share-code">
                            {kind === "puzzle" ? "Answer" : "Code"}: {d.answer}
                          </p>
                        )}
                        <button
                          className="text-button"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(
                                kind === "code" ? (d.answer ?? url) : url,
                              )
                              .then(() => setMessage("Copied"))
                              .catch(() =>
                                setError("Copy failed. Select the text above."),
                              )
                          }
                        >
                          <Copy size={16} />
                          Copy {kind === "code" ? "code" : "link"}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {path === "/create" && (
            <div className="kind-picker">
              {kinds
                .filter((k) => !["map", "prize"].includes(k.value))
                .map(({ value, title, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    <Icon size={24} />
                    {title}
                  </button>
                ))}
            </div>
          )}
          <label>
            Campaign title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              placeholder={
                kind === "prize" ? "Hackathon prizes" : "A little treasure hunt"
              }
            />
          </label>
          {kind === "map" && (
            <label>
              Venue
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                maxLength={120}
                required
              />
            </label>
          )}
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </label>
          <label>
            Ends at
            <input
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
              required
            />
          </label>
          {kind !== "prize" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={single}
                onChange={(e) => setSingle(e.target.checked)}
              />
              One reward per account in this campaign
            </label>
          )}
          {drops.map((d, i) => (
            <fieldset key={i}>
              <legend>
                {kind === "prize" ? "Prize" : "Drop"} {i + 1}
              </legend>
              <label>
                Title
                <input
                  value={d.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  maxLength={100}
                />
              </label>
              {kind === "prize" && (
                <label>
                  Winner email
                  <input
                    type="email"
                    value={d.email}
                    onChange={(e) => update(i, { email: e.target.value })}
                    required
                  />
                </label>
              )}
              <div className="form-columns">
                <label>
                  Reward in USDC
                  <input
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) => update(i, { amount: e.target.value })}
                    required
                  />
                </label>
                {kind !== "prize" && (
                  <label>
                    Number of rewards
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={d.capacity}
                      onChange={(e) =>
                        update(i, { capacity: Number(e.target.value) })
                      }
                      required
                    />
                  </label>
                )}
              </div>
              {kind === "map" && (
                <>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      void freshLocation()
                        .then((p) =>
                          update(i, {
                            latitude: p.latitude,
                            longitude: p.longitude,
                          }),
                        )
                        .catch((e) => setError(e.message));
                    }}
                  >
                    Use my location
                  </button>
                  <PointPicker
                    latitude={d.latitude}
                    longitude={d.longitude}
                    onChange={(latitude, longitude) =>
                      update(i, { latitude, longitude })
                    }
                  />
                  <div className="form-columns">
                    <label>
                      Latitude
                      <input
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        value={d.latitude}
                        onChange={(e) =>
                          update(i, { latitude: Number(e.target.value) })
                        }
                        required
                      />
                    </label>
                    <label>
                      Longitude
                      <input
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        value={d.longitude}
                        onChange={(e) =>
                          update(i, { longitude: Number(e.target.value) })
                        }
                        required
                      />
                    </label>
                  </div>
                  <label>
                    Claiming radius in metres
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={d.radius}
                      onChange={(e) =>
                        update(i, { radius: Number(e.target.value) })
                      }
                      required
                    />
                  </label>
                </>
              )}
              {kind === "puzzle" && (
                <>
                  <label>
                    Riddle
                    <textarea
                      value={d.clue}
                      onChange={(e) => update(i, { clue: e.target.value })}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <label>
                    Answer
                    <input
                      value={d.answer}
                      onChange={(e) => update(i, { answer: e.target.value })}
                      maxLength={500}
                      required
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              {drops.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setDrops((list) => list.filter((_, n) => n !== i))
                  }
                >
                  Remove {kind === "prize" ? "prize" : "drop"}
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={drops.length >= 100}
            onClick={() => setDrops((list) => [...list, newDrop()])}
          >
            <Plus size={18} />
            Add {kind === "prize" ? "winner" : "drop"}
          </button>
          <section className="deposit-summary">
            <h2>Total rewards</h2>
            <strong>{formatUSDC(total)} USDC</strong>
            <p>You’ll review the network fee before funding.</p>
          </section>
          <button className="button primary" disabled={busy}>
            {busy ? "Creating…" : "Create campaign"}
          </button>
        </form>
      )}
      {signedIn && events.length > 0 && (
        <section className="section">
          <h2>Your campaigns</h2>
          {events.map((event) => (
            <article className="operation-card" key={event.id}>
              <strong>{event.title}</strong>
              <span>
                {formatUSDC(event.budget)} · {event.status}
              </span>
              {operations
                .filter((o) => o.event_id === event.id)
                .slice(0, 1)
                .map((o) => (
                  <div key={o.id}>
                    <p>
                      {o.status} · {o.phase}
                    </p>
                    {o.status === "failed" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void retry(event.id)}
                      >
                        Retry operation
                      </button>
                    )}
                  </div>
                ))}
              <div className="row-actions">
                <button
                  className="button secondary"
                  onClick={() => void share(event)}
                >
                  Details
                </button>
                {event.status === "active" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void action(event.id, "pause")}
                  >
                    Pause
                  </button>
                )}
                {event.status === "paused" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void action(event.id, "resume")}
                  >
                    Resume
                  </button>
                )}
                {["active", "paused"].includes(event.status) && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void action(event.id, "close")}
                  >
                    Close
                  </button>
                )}
                {(event.status === "closed" || event.ends_at <= Date.now()) && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void action(event.id, "refund")}
                  >
                    Refund unused
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      <Link className="text-button" href="/">
        <ArrowLeft size={16} />
        Wallet
      </Link>
    </main>
  );
}
