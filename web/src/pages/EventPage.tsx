import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distanceMeters,
  formatUSDC,
  explorerTransaction,
  locationError,
  type LocationEvidence,
} from "@jovva/chain";
import { api, post } from "../lib/api";
import { freshLocation, formatDistance, trackLocation } from "../lib/location";
import { navigate } from "../lib/router";
import type { Claim, Event, Spot } from "../lib/types";
import { EventMap } from "../components/EventMap";
import { Icon } from "../components/Icon";
import { Coin } from "../components/Coin";
export function EventPage({
  id,
  signedIn,
  requestSignIn,
  onHuntChange,
}: {
  id: string;
  signedIn: boolean;
  requestSignIn: () => void;
  onHuntChange: (active: boolean) => void;
}) {
  const [event, setEvent] = useState<Event | null>(null),
    [spots, setSpots] = useState<Spot[]>([]),
    [selected, setSelected] = useState<Spot | null>(null),
    [claim, setClaim] = useState<Claim | null>(null),
    [hunting, setHunting] = useState(false),
    [position, setPosition] = useState<LocationEvidence | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [warming, setWarming] = useState(true),
    [expanded, setExpanded] = useState(false),
    [locating, setLocating] = useState(false);
  const huntSpots = useMemo(() => (selected ? [selected] : []), [selected]);
  const previousDistance = useRef<number | null>(null);
  useEffect(() => {
    onHuntChange(hunting && (!claim || claim.status === "failed"));
    return () => onHuntChange(false);
  }, [hunting, claim?.status, onHuntChange]);
  useEffect(() => {
    if (event?.slug && id !== event.slug)
      navigate(`/events/${event.slug}`, true);
  }, [event?.slug, id]);
  useEffect(() => {
    setSelected((current) =>
      current ? (spots.find((spot) => spot.id === current.id) ?? null) : null,
    );
  }, [spots]);
  async function locate() {
    setLocating(true);
    setError("");
    try {
      setPosition(await freshLocation());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }

  const load = useCallback(async () => {
    const data = await api<{
      event: Event;
      spots: Spot[];
      claim: Claim | null;
    }>(`/events/${id}`);
    setEvent(data.event);
    setSpots(data.spots);
    setClaim(data.claim);
  }, [id]);
  useEffect(() => {
    let alive = true;
    setError("");
    void api<{ event: Event; spots: Spot[]; claim: Claim | null }>(
      `/events/${id}`,
    )
      .then((data) => {
        if (alive) {
          setEvent(data.event);
          setSpots(data.spots);
          setClaim(data.claim);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id, signedIn]);
  useEffect(() => {
    if (!hunting || !selected) return;
    const stop = trackLocation((location) => {
      setPosition(location);
      const d = distanceMeters(location, selected);
      setWarming(
        previousDistance.current === null || d <= previousDistance.current + 3,
      );
      previousDistance.current = d;
    }, setError);
    return () => {
      stop();
      previousDistance.current = null;
    };
  }, [hunting, selected]);
  useEffect(() => {
    if (!claim || !["reserved", "submitted"].includes(claim.status)) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void api<{ claim: Claim }>(`/claims/${claim.id}`)
        .then((data) => {
          if (alive) {
            setClaim(data.claim);
            if (
              data.claim.status === "confirmed" ||
              data.claim.status === "failed"
            )
              setHunting(false);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [claim?.id, claim?.status]);
  const distance =
    position && selected ? distanceMeters(position, selected) : null;
  const nearby =
    position && selected ? !locationError(position, selected) : false;
  const unavailable =
    !event ||
    event.status !== "active" ||
    Date.now() < event.starts_at ||
    Date.now() >= event.ends_at;
  async function collect() {
    if (!signedIn) {
      requestSignIn();
      return;
    }
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await post("/wallet");
      const location = await freshLocation();
      setPosition(location);
      const result = await post<{ claim: Claim }>("/claims", {
        spotId: selected.id,
        location,
      });
      setClaim(result.claim);
      setHunting(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!event)
    return (
      <main className="page">
        <button className="text-button" onClick={() => navigate("/")}>
          <Icon name="back" />
          All events
        </button>
        <div className="empty-state" role="status">
          {error || "Finding this adventure…"}
        </div>
      </main>
    );
  if (claim && claim.status !== "failed")
    return (
      <main className="page claim-page">
        <button className="text-button" onClick={() => navigate("/")}>
          <Icon name="back" />
          All events
        </button>
        <div
          className={`claim-result ${claim.status === "confirmed" ? "confirmed" : ""}`}
        >
          <Coin />
          <h1>
            {claim.status === "confirmed"
              ? `You found ${formatUSDC(claim.amount)}.`
              : "Your drop is on its way."}
          </h1>
          <p>
            {claim.status === "confirmed"
              ? "Your USDC is now in your wallet."
              : "Your reward is reserved. We’re waiting for the Arc transaction to finish."}
          </p>
          <dl className="receipt">
            <div>
              <dt>Found at</dt>
              <dd>{event.venue}</dd>
            </div>
            <div>
              <dt>Reward</dt>
              <dd>{formatUSDC(claim.amount)} USDC</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="receipt-status">
                <Icon name={claim.status === "confirmed" ? "check" : "clock"} />
                {claim.status === "confirmed" ? "Confirmed" : "Pending"}
              </dd>
            </div>
          </dl>
          {claim.transactionHash && (
            <a
              className="text-button"
              href={explorerTransaction(claim.transactionHash)}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
              <Icon name="external" size={16} />
            </a>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full"
            onClick={() => navigate("/wallet")}
          >
            View my wallet
            <Icon name="wallet" />
          </button>
          <button
            className="button secondary full"
            onClick={() => navigate("/")}
          >
            Explore other events
          </button>
          <small>One reward per account, per event.</small>
        </div>
      </main>
    );
  if (hunting && selected)
    return (
      <main className="hunt-page page">
        <div className="hunt-top">
          <button
            className="icon-button"
            aria-label="Close hunt"
            onClick={() => setHunting(false)}
          >
            <Icon name="close" />
          </button>
          <div>
            <h1>
              {nearby
                ? "You’re here."
                : `Hunting ${formatUSDC(selected.amount)}`}
            </h1>
            <p>
              {selected.title} · {event.venue}
            </p>
          </div>
          <span className="hunt-top-spacer" />
        </div>
        {nearby ? (
          <div className="arrival">
            <div className="arrival-aura" />
            <Coin />
            <div className="coin-ground" />
            <h2>{formatUSDC(selected.amount)} drop</h2>
            <p>You’ve reached its claiming area.</p>
          </div>
        ) : (
          <div className="hunt-dial">
            <span className="dial-pointer" />
            <span className="dial-coin">
              <Coin small />
            </span>
            <div className="dial-reading">
              <strong>
                {distance === null ? "—" : Math.round(distance)}
                <span>m</span>
              </strong>
              <span className="warm-label">
                {distance === null
                  ? "Finding your location"
                  : warming
                    ? "Getting warmer"
                    : "A little further away"}
              </span>
              <small>{selected.radius} m claiming area</small>
            </div>
          </div>
        )}
        <div className="hunt-map">
          <EventMap
            event={event}
            spots={huntSpots}
            selected={selected.id}
            onSelect={() => {}}
            position={position}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {position && position.accuracy > 50 && (
          <p className="error">
            Your location is only accurate to {Math.round(position.accuracy)} m.
            Try an open area.
          </p>
        )}
        <button
          className="button primary full hunt-claim"
          disabled={!nearby || busy || unavailable}
          onClick={() => void collect()}
        >
          {busy
            ? "Collecting…"
            : !nearby
              ? "Walk closer to unlock"
              : signedIn
                ? `Collect ${formatUSDC(selected.amount)}`
                : "Sign in to collect"}
          <Icon name={nearby ? "wallet" : "locate"} />
        </button>
        <p className="hunt-note">
          Keep Jovva open while you walk. Stay within the venue’s public areas.
        </p>
      </main>
    );
  return (
    <main className="map-page event-map-page">
      <EventMap
        event={event}
        spots={spots}
        selected={selected?.id ?? null}
        onSelect={(spot) => {
          setSelected(spot);
          setExpanded(false);
          setError("");
        }}
        position={position}
      />
      <div className="event-map-title">
        <button
          className="icon-button"
          aria-label="All events"
          onClick={() => navigate("/")}
        >
          <Icon name="back" />
        </button>
        <div>
          <h1>{event.title}</h1>
          <p>{event.venue}</p>
        </div>
      </div>
      <button
        className="icon-button map-locate"
        aria-label="Locate me"
        disabled={locating}
        onClick={() => void locate()}
      >
        <Icon name="locate" />
      </button>
      <section
        className={`map-sheet reward-sheet ${expanded ? "expanded" : ""}`}
        aria-labelledby="drops-title"
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-heading">
          <h2 id="drops-title">
            {selected ? `${formatUSDC(selected.amount)} drop` : "Choose a drop"}
          </h2>
          <button
            className="text-button"
            aria-expanded={expanded}
            aria-controls="drop-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Close list" : "View drops"}
          </button>
        </div>
        {selected ? (
          <div className="reward-details">
            <p>
              {selected.title}
              {distance !== null ? ` · ${formatDistance(distance)} away` : ""}
            </p>
            <div className="reward-facts">
              <span>
                {selected.remaining}{" "}
                {selected.remaining === 1 ? "reward" : "rewards"} left
              </span>
              <span>{selected.radius} m claiming radius</span>
            </div>
          </div>
        ) : (
          <p className="sheet-description">
            Select a reward on the map or from the list.
          </p>
        )}
        {
          <div id="drop-list" className="sheet-list" hidden={!expanded}>
            {event.description && (
              <p className="event-description">{event.description}</p>
            )}
            <p className="event-schedule">
              Ends{" "}
              {new Date(event.ends_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · One reward per event
            </p>
            {spots.map((spot) => (
              <button
                key={spot.id}
                className={`drop-row ${selected?.id === spot.id ? "selected" : ""}`}
                aria-pressed={selected?.id === spot.id}
                disabled={spot.remaining === 0}
                onClick={() => {
                  setSelected(spot);
                  setExpanded(false);
                  setError("");
                }}
              >
                <Coin small />
                <span className="drop-row-main">
                  <strong>{spot.title}</strong>
                  <small>
                    {spot.remaining
                      ? `${spot.remaining} left · ${spot.radius} m radius`
                      : "All collected"}
                  </small>
                </span>
                <span className="drop-amount">
                  {formatUSDC(spot.amount)}
                  <Icon name="arrow" size={17} />
                </span>
              </button>
            ))}
            {!spots.length && <p>No drops are available at this event.</p>}
          </div>
        }
        {unavailable && (
          <p className="sheet-description">
            {Date.now() >= event.ends_at
              ? "This event has ended."
              : event.status === "paused"
                ? "Claims are paused."
                : Date.now() < event.starts_at
                  ? "This event hasn’t started yet."
                  : "Claims are closed."}
          </p>
        )}
        {claim?.status === "failed" && (
          <p className="error" role="alert">
            Your last payout failed. Its slot was returned; you can try again.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected && (
          <button
            className="button primary full"
            disabled={unavailable || selected.remaining === 0}
            onClick={() => {
              setHunting(true);
              setError("");
            }}
          >
            Start hunt
            <Icon name="compass" />
          </button>
        )}
        <button
          className="text-button refresh-link"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh availability
        </button>
      </section>
    </main>
  );
}
