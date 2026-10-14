import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Coordinates } from "@jovva/chain";
import { Spinner } from "./Spinner";
import { formatUSDC } from "@jovva/chain";
import { restyleMap } from "../lib/map-style";
import type { Event, Spot } from "../lib/types";

const EMPTY_SPOTS: Spot[] = [];
const EMPTY_EVENTS: Event[] = [];
const STYLE = "https://tiles.openfreemap.org/styles/positron";

export function EventMap({
  event,
  events = EMPTY_EVENTS,
  spots = EMPTY_SPOTS,
  selected = null,
  onSelect,
  onEventSelect,
  position,
}: {
  event?: Event;
  events?: Event[];
  spots?: Spot[];
  selected?: string | null;
  onSelect?: (spot: Spot) => void;
  onEventSelect?: (event: Event) => void;
  position: Coordinates | null;
}) {
  const rewards = !!event || spots.length > 0;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const callbacks = useRef({ onSelect, onEventSelect });
  callbacks.current = { onSelect, onEventSelect };
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const controller = new AbortController();
    let instance: maplibregl.Map | null = null;
    let resize: ResizeObserver | null = null;
    let alive = true;
    setFailed(false);
    setLoading(true);
    const timeout = window.setTimeout(() => {
      if (!alive) return;
      controller.abort();
      setFailed(true);
      setLoading(false);
    }, 15000);
    void fetch(STYLE, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Map style unavailable");
        const style = restyleMap(await response.json());
        if (!alive) return;
        const center = event ??
          spots[0] ??
          events[0] ?? { longitude: 3.3966, latitude: 6.4474 };
        instance = new maplibregl.Map({
          container: container.current!,
          style,
          center: [center.longitude, center.latitude],
          zoom: 15,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        const bounds = new maplibregl.LngLatBounds();
        for (const item of rewards ? spots : events) {
          bounds.extend([item.longitude, item.latitude]);
          const button = document.createElement("button");
          button.className = rewards ? "map-pin" : "event-map-pin";
          button.dataset.id = item.id;
          button.setAttribute(
            "aria-label",
            rewards
              ? `${item.title}, ${formatUSDC((item as Spot).amount)}, ${(item as Spot).remaining} remaining`
              : `${item.title}, ${(item as Event).venue ?? ""}`,
          );
          if (rewards) {
            button.disabled =
              (item as Spot).remaining === 0 || !!(item as Spot).claimed;
            button.setAttribute("aria-pressed", String(item.id === selected));
            const image = document.createElement("img");
            image.src = "/coin/front.png";
            image.alt = "";
            const label = document.createElement("span");
            label.className = "pin-amount";
            label.textContent = formatUSDC((item as Spot).amount);
            button.append(image, label);
            button.onclick = () => callbacks.current.onSelect?.(item as Spot);
          } else {
            button.textContent = item.title;
            button.onclick = () =>
              callbacks.current.onEventSelect?.(item as Event);
          }
          new maplibregl.Marker({ element: button })
            .setLngLat([item.longitude, item.latitude])
            .addTo(instance);
        }
        if ((rewards ? spots : events).length)
          instance.fitBounds(bounds, {
            padding:
              container.current!.clientHeight < 400
                ? 24
                : { top: 130, bottom: 280, left: 70, right: 70 },
            maxZoom: event ? 16 : 13,
            duration: 0,
          });
        instance.once("load", () => {
          if (!alive) return;
          clearTimeout(timeout);
          setLoading(false);
        });
        // Individual tile/source errors leave the usable map intact. The initial
        // load timeout handles complete failure rather than every error event.
        resize = new ResizeObserver(() => instance?.resize());
        resize.observe(container.current!);
      })
      .catch(() => {
        if (alive) {
          clearTimeout(timeout);
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timeout);
      resize?.disconnect();
      instance?.remove();
      map.current = null;
    };
  }, [event?.id, events, spots, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !position || loading || failed) return;
    const dot = document.createElement("span");
    dot.className = "location-marker";
    const point = document.createElement("span");
    point.className = "location-dot";
    dot.append(point);
    const target = spots.find((spot) => spot.id === selected);
    if (target) {
      const bearing =
        (Math.atan2(
          (target.longitude - position.longitude) *
            Math.cos((position.latitude * Math.PI) / 180),
          target.latitude - position.latitude,
        ) *
          180) /
        Math.PI;
      const cone = document.createElement("span");
      cone.className = "direction-cone";
      cone.style.transform = `rotate(${bearing}deg)`;
      cone.setAttribute("aria-hidden", "true");
      dot.prepend(cone);
    }
    const guidance = {
      type: "FeatureCollection" as const,
      features: target
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [position.longitude, position.latitude],
                  [target.longitude, target.latitude],
                ],
              },
            },
          ]
        : [],
    };
    if (instance.getSource("guidance"))
      (instance.getSource("guidance") as maplibregl.GeoJSONSource).setData(
        guidance,
      );
    else {
      instance.addSource("guidance", { type: "geojson", data: guidance });
      instance.addLayer({
        id: "guidance",
        type: "line",
        source: "guidance",
        paint: {
          "line-color": "#1f6bff",
          "line-width": 3,
          "line-dasharray": [1, 2],
        },
      });
    }
    dot.setAttribute("aria-label", "Your location");
    const marker = new maplibregl.Marker({ element: dot, rotationAlignment: "map" })
      .setLngLat([position.longitude, position.latitude])
      .addTo(instance);
    const bounds = new maplibregl.LngLatBounds().extend([
      position.longitude,
      position.latitude,
    ]);
    for (const item of rewards ? spots : events)
      bounds.extend([item.longitude, item.latitude]);
    instance.fitBounds(bounds, {
      padding:
        container.current!.clientHeight < 400
          ? 24
          : { top: 130, bottom: 280, left: 70, right: 70 },
      maxZoom: event ? 16 : 14,
      duration: 0,
    });
    return () => {
      marker.remove();
    };
  }, [position, selected, loading, failed, event?.id, spots, events]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || loading || failed || !rewards) return;
    container.current
      ?.querySelectorAll<HTMLButtonElement>(".map-pin")
      .forEach((button) => {
        const active = button.dataset.id === selected;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-pressed", String(active));
      });
    const features = spots.map((spot) => ({
      type: "Feature" as const,
      properties: { selected: spot.id === selected },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          Array.from({ length: 65 }, (_, i) => {
            const angle = (i / 64) * Math.PI * 2;
            return [
              spot.longitude +
                (Math.cos(angle) * spot.radius) /
                  (111320 * Math.cos((spot.latitude * Math.PI) / 180)),
              spot.latitude + (Math.sin(angle) * spot.radius) / 111320,
            ];
          }),
        ],
      },
    }));
    const data = { type: "FeatureCollection" as const, features };
    if (instance.getSource("radii"))
      (instance.getSource("radii") as maplibregl.GeoJSONSource).setData(data);
    else {
      instance.addSource("radii", { type: "geojson", data });
      instance.addLayer({
        id: "radii",
        type: "fill",
        source: "radii",
        paint: {
          "fill-color": "#1665e8",
          "fill-opacity": ["case", ["get", "selected"], 0.14, 0.05],
        },
      });
      instance.addLayer({
        id: "radius-lines",
        type: "line",
        source: "radii",
        paint: {
          "line-color": "#1665e8",
          "line-width": ["case", ["get", "selected"], 2, 1],
        },
      });
    }
  }, [selected, spots, loading, failed, event?.id, rewards]);

  return (
    <div className="map-container">
      <div
        ref={container}
        className="event-map"
        aria-label={event ? `Reward map for ${event.title}` : "Event map"}
      />
      {loading && !failed && (
        <div className="map-loading">
          <Spinner label="Loading map" />
        </div>
      )}
      {failed && (
        <div className="map-error" role="alert">
          <h2>Map couldn’t load.</h2>
          <p>You can still choose from the list below.</p>
          <button
            className="button secondary"
            onClick={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            Retry map
          </button>
        </div>
      )}
    </div>
  );
}
