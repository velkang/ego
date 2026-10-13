import { useEffect, useState } from "react";
import { formatUSDC } from "@jovva/chain";
import { api, post } from "../lib/api";
import type { Event, Operation } from "../lib/types";
import { Icon } from "../components/Icon";
type SpotInput = {
  title: string;
  latitude: string;
  longitude: string;
  radius: string;
  amount: string;
  capacity: string;
};
const blankSpot = (): SpotInput => ({
  title: "",
  latitude: "",
  longitude: "",
  radius: "50",
  amount: "1",
  capacity: "10",
});
export function AdminPage() {
  const [events, setEvents] = useState<Event[]>([]),
    [operations, setOperations] = useState<Operation[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [spots, setSpots] = useState<SpotInput[]>([blankSpot()]);
  async function load() {
    const result = await api<{ events: Event[]; operations: Operation[] }>(
      "/admin/events",
    );
    setEvents(result.events);
    setOperations(result.operations);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void load().catch((e) => setError(e.message));
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await post(path, body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    const fields = new FormData(form);
    try {
      const convertedSpots = spots.map((s) => ({
        title: s.title,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        radius: Number(s.radius),
        amount: Math.round(Number(s.amount) * 1e6),
        capacity: Number(s.capacity),
      }));
      const first = convertedSpots[0];
      await post("/admin/events", {
        title: fields.get("title"),
        venue: fields.get("venue"),
        description: fields.get("description"),
        latitude: first.latitude,
        longitude: first.longitude,
        startsAt: new Date(String(fields.get("startsAt"))).getTime(),
        endsAt: new Date(String(fields.get("endsAt"))).getTime(),
        spots: convertedSpots,
      });
      setCreating(false);
      setSpots([blankSpot()]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const budget = spots.reduce(
    (total, spot) => total + Number(spot.amount) * Number(spot.capacity),
    0,
  );
  return (
    <main className="page admin-page">
      <div className="section-heading">
        <div>
          <h1>Make an adventure.</h1>
          <p>Team dashboard</p>
        </div>
        <button
          className="button primary"
          onClick={() => setCreating(!creating)}
        >
          <Icon name={creating ? "close" : "plus"} />
          {creating ? "Cancel" : "New event"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {creating && (
        <form
          className="event-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create(e.currentTarget);
          }}
        >
          <h2>Event details</h2>
          <div className="form-grid">
            <label>
              Event name
              <input
                name="title"
                required
                maxLength={100}
                placeholder="An afternoon in the garden"
              />
            </label>
            <label>
              Venue
              <input
                name="venue"
                required
                maxLength={120}
                placeholder="Where the adventure happens"
              />
            </label>
            <label>
              Starts at
              <input type="datetime-local" name="startsAt" required />
            </label>
            <label>
              Ends at
              <input type="datetime-local" name="endsAt" required />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              maxLength={1000}
              rows={3}
              placeholder="Tell visitors what to expect."
            />
          </label>
          <h2>Reward spots</h2>
          <p className="form-help">
            Use coordinates from your venue. Amounts are per winner; the first
            spot centers the event map.
          </p>
          {spots.map((spot, index) => (
            <fieldset className="spot-form" key={index}>
              <legend>Spot {index + 1}</legend>
              <div className="form-grid">
                {(
                  [
                    "title",
                    "latitude",
                    "longitude",
                    "radius",
                    "amount",
                    "capacity",
                  ] as const
                ).map((field) => (
                  <label key={field}>
                    {
                      {
                        title: "Spot name",
                        latitude: "Latitude",
                        longitude: "Longitude",
                        radius: "Radius (metres)",
                        amount: "Reward (USDC)",
                        capacity: "Number of winners",
                      }[field]
                    }
                    <input
                      required
                      type={field === "title" ? "text" : "number"}
                      step={
                        field === "capacity" || field === "radius"
                          ? "1"
                          : field === "amount"
                            ? "0.01"
                            : "any"
                      }
                      min={
                        field === "latitude"
                          ? -90
                          : field === "longitude"
                            ? -180
                            : field === "radius"
                              ? 10
                              : field === "capacity"
                                ? 1
                                : field === "amount"
                                  ? 0.01
                                  : undefined
                      }
                      max={
                        field === "latitude"
                          ? 90
                          : field === "longitude"
                            ? 180
                            : field === "radius"
                              ? 500
                              : field === "capacity"
                                ? 10000
                                : field === "amount"
                                  ? 100
                                  : undefined
                      }
                      value={spot[field]}
                      onChange={(e) =>
                        setSpots((current) =>
                          current.map((s, i) =>
                            i === index ? { ...s, [field]: e.target.value } : s,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {spots.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setSpots((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remove spot
                </button>
              )}
            </fieldset>
          ))}
          <button
            className="button secondary"
            type="button"
            disabled={spots.length >= 100}
            onClick={() => setSpots((current) => [...current, blankSpot()])}
          >
            <Icon name="plus" />
            Add spot
          </button>
          <div className="form-total">
            <span>
              Total reward budget
              <strong>{formatUSDC(Math.round(budget * 1e6))} USDC</strong>
            </span>
            <button className="button primary" disabled={busy}>
              Save draft
              <Icon name="arrow" />
            </button>
          </div>
        </form>
      )}
      <section className="admin-events">
        <h2>Your events</h2>
        {!events.length && (
          <p className="empty-state compact">
            Create your first event to place some drops.
          </p>
        )}
        {events.map((event) => {
          const pending = operations.find(
              (op) => op.event_id === event.id && op.status === "pending",
            ),
            latest = operations.find((op) => op.event_id === event.id);
          return (
            <article className="admin-event" key={event.id}>
              <div className="admin-event-head">
                <div>
                  <h3>{event.title}</h3>
                  <p>
                    {event.venue} · {new Date(event.starts_at).toLocaleString()}
                  </p>
                </div>
                <span className="state-label">{event.status}</span>
              </div>
              <p>
                {formatUSDC(event.budget)} budget ·{" "}
                {pending
                  ? `${pending.action}: ${pending.phase} pending`
                  : latest?.status === "failed"
                    ? `${latest.phase} failed`
                    : "No operation pending"}
              </p>
              <div className="admin-actions">
                {event.status === "draft" && (
                  <button
                    className="button primary"
                    disabled={busy || !!pending}
                    onClick={() =>
                      void run(`/admin/events/${event.id}/actions`, {
                        action: "launch",
                      })
                    }
                  >
                    Fund & activate
                  </button>
                )}
                {event.status === "active" && (
                  <button
                    className="button secondary"
                    disabled={busy || !!pending}
                    onClick={() =>
                      void run(`/admin/events/${event.id}/actions`, {
                        action: "pause",
                      })
                    }
                  >
                    Pause claims
                  </button>
                )}
                {event.status === "paused" && (
                  <button
                    className="button primary"
                    disabled={busy || !!pending}
                    onClick={() =>
                      void run(`/admin/events/${event.id}/actions`, {
                        action: "resume",
                      })
                    }
                  >
                    Resume claims
                  </button>
                )}
                {!["draft", "closed"].includes(event.status) && (
                  <button
                    className="button secondary"
                    disabled={busy || !!pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Close this event? Visitors will no longer be able to collect its rewards.",
                        )
                      )
                        void run(`/admin/events/${event.id}/actions`, {
                          action: "close",
                        });
                    }}
                  >
                    Close event
                  </button>
                )}
                {(event.status === "closed" ||
                  (event.status !== "draft" &&
                    Date.now() >= event.ends_at)) && (
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      !!pending ||
                      (latest?.action === "refund" &&
                        latest.status === "complete")
                    }
                    onClick={() =>
                      void run(`/admin/events/${event.id}/actions`, {
                        action: "refund",
                      })
                    }
                  >
                    Recover unused funds
                  </button>
                )}
                {latest?.status === "failed" && !pending && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(`/admin/operations/${latest.id}/retry`)
                    }
                  >
                    Retry {latest.phase}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
