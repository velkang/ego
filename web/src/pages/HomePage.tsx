import { useEffect, useState } from "react";
import { formatUSDC, type LocationEvidence } from "@jovva/chain";
import { api } from "../lib/api";
import type { Event } from "../lib/types";
import { freshLocation, formatDistance } from "../lib/location";
import { navigate } from "../lib/router";
import { Icon } from "../components/Icon";
import { EventMap } from "../components/EventMap";
export function HomePage() {
  const [events, setEvents] = useState<Event[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [position, setPosition] = useState<LocationEvidence | null>(null),
    [locating, setLocating] = useState(false),
    [expanded, setExpanded] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ events: Event[] }>(
      `/events${position ? `?latitude=${position.latitude}&longitude=${position.longitude}` : ""}`,
    )
      .then((data) => {
        if (alive) {
          setEvents(data.events);
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
  }, [position, reload]);
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
  const openEvent = (event: Event) => navigate(`/events/${event.slug}`);
  return (
    <main className="map-page">
      <EventMap events={events} position={position} onEventSelect={openEvent} />
      <button
        className="icon-button map-locate"
        aria-label="Locate me"
        disabled={locating}
        onClick={() => void locate()}
      >
        <Icon name="locate" />
      </button>
      <section
        className={`map-sheet discovery-sheet ${expanded ? "expanded" : ""}`}
        aria-labelledby="events-title"
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-heading">
          <h1 id="events-title">
            {position ? "Events near you" : "Explore events"}
          </h1>
          <button
            className="text-button"
            aria-expanded={expanded}
            aria-controls="event-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Close list" : "View events"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div id="event-list" className="sheet-list">
          {loading && !events.length ? (
            <p role="status">Loading events…</p>
          ) : events.length ? (
            (expanded ? events : events.slice(0, 1)).map((event) => (
              <button
                key={event.id}
                className="map-event-row"
                onClick={() => openEvent(event)}
              >
                <span className="map-event-main">
                  <strong>{event.title}</strong>
                  <span>{event.venue}</span>
                  <small>
                    {event.status === "paused"
                      ? "Paused"
                      : Date.now() < event.starts_at
                        ? "Starts soon"
                        : `${event.remaining} rewards left`}
                    {event.distance != null
                      ? ` · ${formatDistance(event.distance)}`
                      : ""}
                  </small>
                </span>
                <span className="map-event-amount">
                  {formatUSDC(event.min_amount ?? 0)}–
                  {formatUSDC(event.max_amount ?? 0)}
                  <Icon name="arrow" size={18} />
                </span>
              </button>
            ))
          ) : (
            <div className="sheet-empty">
              <p>
                {error ? "Events couldn’t load." : "No active events nearby."}
              </p>
              <button
                className="text-button"
                onClick={() => setReload((value) => value + 1)}
              >
                Refresh events
              </button>
            </div>
          )}
        </div>
        {!expanded && events.length > 1 && (
          <button className="text-button" onClick={() => setExpanded(true)}>
            View all {events.length} events
          </button>
        )}
      </section>
    </main>
  );
}
