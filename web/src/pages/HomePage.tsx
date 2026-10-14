import { useEffect, useMemo, useState } from "react";
import { LocateFixed, Compass } from "lucide-react";
import {
  distanceMeters,
  formatUSDC,
  type LocationEvidence,
} from "@jovva/chain";
import { api } from "../lib/api";
import type { Spot } from "../lib/types";
import { freshLocation, formatDistance } from "../lib/location";
import { navigate } from "../lib/router";
import { EventMap } from "../components/EventMap";
import { Spinner } from "../components/Spinner";
import { Coin } from "../components/Coin";
type Drop = Spot & {
  event_slug: string;
  campaign_title: string;
  venue: string;
  event_status: string;
};
export function HomePage() {
  const [drops, setDrops] = useState<Drop[]>([]),
    [selected, setSelected] = useState<Drop | null>(null),
    [position, setPosition] = useState<LocationEvidence | null>(null),
    [loading, setLoading] = useState(true),
    [locating, setLocating] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void api<{ drops: Drop[] }>("/drops")
      .then((d) => {
        if (alive) {
          setDrops(d.drops);
          setSelected((current) =>
            current ? (d.drops.find((s) => s.id === current.id) ?? null) : null,
          );
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);
  const sorted = useMemo(
    () =>
      position
        ? [...drops].sort(
            (a, b) => distanceMeters(position, a) - distanceMeters(position, b),
          )
        : drops,
    [drops, position],
  );
  const distance =
    position && selected ? distanceMeters(position, selected) : null;
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
  const select = (spot: Spot) => {
    setSelected(spot as Drop);
    setExpanded(false);
  };
  return (
    <main className="map-page">
      <EventMap
        spots={drops}
        selected={selected?.id ?? null}
        position={position}
        onSelect={select}
      />
      <div className="map-top">
        <div className="map-campaign">
          <Coin small />
          <div>
            <strong>{selected?.campaign_title ?? "Money drops"}</strong>
            <span>
              {drops.reduce((sum, d) => sum + d.remaining, 0)} rewards on the
              map
            </span>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Locate me"
          disabled={locating}
          onClick={() => void locate()}
        >
          <LocateFixed size={20} />
        </button>
      </div>
      <section
        className={`map-sheet discovery-sheet ${expanded ? "expanded" : ""}`}
        aria-labelledby="drops-heading"
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-heading">
          <h2 id="drops-heading">
            {selected
              ? `${formatUSDC(selected.amount)} USDC`
              : "Find a money drop"}
          </h2>
          <button
            className="text-button"
            aria-expanded={expanded}
            aria-controls="drop-list"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Close list" : "View drops"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected ? (
          <>
            <div className="reward-details">
              <p>
                {selected.title} · {selected.venue}
              </p>
              <div className="reward-facts">
                <span>{selected.remaining} left</span>
                <span>
                  {distance !== null
                    ? `${formatDistance(distance)} away`
                    : `${selected.radius} m claiming radius`}
                </span>
              </div>
            </div>
            <button
              className="button primary"
              disabled={
                selected.remaining === 0 || selected.event_status !== "active"
              }
              onClick={() =>
                navigate(
                  `/events/${selected.event_slug}#spot=${selected.id}&hunt=1`,
                )
              }
            >
              <Compass size={18} />
              {selected.event_status === "paused"
                ? "Claims paused"
                : selected.remaining === 0
                  ? "All collected"
                  : "Start hunt"}
            </button>
          </>
        ) : loading ? (
          <Spinner label="Loading drops" />
        ) : (
          <p className="sheet-description">
            {drops.length
              ? "Choose a coin on the map or open the list."
              : "No drops available to claim right now."}
          </p>
        )}
        <div id="drop-list" className="sheet-list" hidden={!expanded}>
          {sorted.map((d) => (
            <button
              className={`drop-row ${selected?.id === d.id ? "selected" : ""}`}
              aria-pressed={selected?.id === d.id}
              key={d.id}
              onClick={() => select(d)}
            >
              <Coin small />
              <span className="drop-row-main">
                <strong>{d.title}</strong>
                <small>
                  {d.venue} · {d.remaining} left
                  {position
                    ? ` · ${formatDistance(distanceMeters(position, d))}`
                    : ""}
                </small>
              </span>
              <strong className="drop-amount">{formatUSDC(d.amount)}</strong>
            </button>
          ))}
        </div>
        <button className="text-button" onClick={() => setReload((v) => v + 1)}>
          Refresh availability
        </button>
      </section>
    </main>
  );
}
