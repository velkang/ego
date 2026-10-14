import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distanceMeters,
  formatUSDC,
  locationError,
  type LocationEvidence,
} from "@jovva/chain";
import { api, post } from "../lib/api";
import { freshLocation, formatDistance, trackLocation } from "../lib/location";
import { navigate } from "../lib/router";
import type { Claim, Event, Spot } from "../lib/types";
import { EventMap } from "../components/EventMap";
import { Icon } from "../components/Icon";
import { Scene } from "../components/Scene";
import { ClaimReceipt } from "../components/ClaimReceipt";
import { HoldButton } from "../components/HoldButton";
import { Coin, LargeCoin } from "../components/Coin";
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
  const consumedIntent = useRef(false);
  const previousDistance = useRef<number | null>(null);
  useEffect(() => {
    onHuntChange(hunting || (!!claim && claim.status !== "failed"));
    return () => onHuntChange(false);
  }, [hunting, claim?.status, onHuntChange]);
  useEffect(() => {
    if (event?.kind && event.kind !== "map") {
      navigate(
        event.kind === "prize"
          ? "/prizes"
          : `/enter/${event.kind}?event=${event.slug}`,
        true,
      );
      return;
    }
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

  useEffect(() => {
    if (consumedIntent.current) return;
    const params = new URLSearchParams(location.hash.slice(1)),
      spot = spots.find((s) => s.id === params.get("spot"));
    if (spot) {
      consumedIntent.current = true;
      setSelected(spot);
      if (params.get("hunt") === "1" && !spot.claimed) setHunting(true);
    }
  }, [spots]);
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
  const distance =
    position && selected ? distanceMeters(position, selected) : null;
  const bearing =
    position && selected
      ? (() => {
          const a = (position.latitude * Math.PI) / 180,
            b = (selected.latitude * Math.PI) / 180,
            delta = ((selected.longitude - position.longitude) * Math.PI) / 180;
          return (
            ((Math.atan2(
              Math.sin(delta) * Math.cos(b),
              Math.cos(a) * Math.sin(b) -
                Math.sin(a) * Math.cos(b) * Math.cos(delta),
            ) *
              180) /
              Math.PI +
              360) %
            360
          );
        })()
      : 0;
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
        <button className="text-button" onClick={() => navigate("/explore")}>
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
      <ClaimReceipt
        initial={claim}
        venue={event.venue}
        onRetry={() => {
          setClaim(null);
          setHunting(false);
          void load();
        }}
        onContinue={
          event.single_claim === 0
            ? () => {
                setClaim(null);
                setSelected(null);
                setHunting(false);
                void load();
              }
            : undefined
        }
      />
    );
  if (hunting && selected && nearby)
    return (
      <Scene>
        <div className="scene-top">
          <button
            className="icon-button"
            aria-label="Close hunt"
            onClick={() => setHunting(false)}
          >
            <Icon name="close" />
          </button>
          <span className="here-pill">You’re here</span>
          <span style={{ width: 42 }} />
        </div>
        <div className="scene-center">
          <LargeCoin size={260} entrance="drop" />
          <div className="ground-ring" aria-hidden="true" />
        </div>
        <div className="scene-bottom">
          <h2>{formatUSDC(selected.amount)} USDC</h2>
          <p>{selected.title}</p>
          {error && (
            <p className="scene-error" role="alert">
              {error}
            </p>
          )}
          {signedIn ? (
            <HoldButton
              variant="ring"
              disabled={unavailable}
              busy={busy}
              onComplete={() => void collect()}
            >
              Hold to claim
            </HoldButton>
          ) : (
            <button className="button primary" onClick={requestSignIn}>
              Sign in to claim
            </button>
          )}
          <p>Release to cancel</p>
        </div>
      </Scene>
    );
  if (hunting && selected)
    return (
      <main className={`hunt-page page ${nearby ? "arrived" : ""}`}>
        <div className="hunt-head">
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
        <div className="dial-wrap">
          <div className="dial">
            <span className="dial-ticks" />
            <span className="dial-ticks major" />
            <span className="dial-north" />
            <div
              className="dial-orbit"
              style={{ transform: `rotate(${bearing}deg)` }}
            >
              <span
                className="coin-marker"
                style={{
                  transform: `translate(-50%,0) rotate(${-bearing}deg)`,
                }}
              >
                <Coin small />
              </span>
            </div>
            <div className="dial-face">
              <strong className="amount">
                {distance === null ? "—" : Math.round(distance)}
                <span className="cur">m</span>
              </strong>
              <span className={`dial-trend ${warming ? "" : "cold"}`}>
                {distance === null
                  ? "Finding your location"
                  : warming
                    ? "Getting warmer"
                    : "Getting colder"}
              </span>
              <span className="dial-sub">
                {position
                  ? `${["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"][Math.round(bearing / 45) % 8]} · `
                  : ""}
                {selected.radius} m claiming area
              </span>
            </div>
          </div>
        </div>
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
        {nearby && signedIn ? (
          <HoldButton
            disabled={unavailable}
            busy={busy}
            onComplete={() => void collect()}
          >
            Hold to claim {formatUSDC(selected.amount)}
          </HoldButton>
        ) : (
          <button
            className="button primary"
            disabled={!nearby || busy || unavailable}
            onClick={requestSignIn}
          >
            {nearby ? "Sign in to claim" : "Walk closer to unlock"}
          </button>
        )}
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
          onClick={() => navigate("/explore")}
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
              ·{" "}
              {event.single_claim === 0
                ? "One reward per drop"
                : "One reward per campaign"}
            </p>
            {spots.map((spot) => (
              <button
                key={spot.id}
                className={`drop-row ${selected?.id === spot.id ? "selected" : ""}`}
                aria-pressed={selected?.id === spot.id}
                disabled={spot.remaining === 0 || spot.claimed}
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
                    {spot.claimed
                      ? "Collected by you"
                      : spot.remaining
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
            disabled={
              unavailable || selected.remaining === 0 || selected.claimed
            }
            onClick={() => {
              setHunting(true);
              setError("");
            }}
          >
            {selected.claimed ? "Already collected" : "Start hunt"}
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
