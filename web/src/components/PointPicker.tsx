import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
export function PointPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    callback = useRef(onChange),
    marker = useRef<maplibregl.Marker | null>(null),
    mapRef = useRef<maplibregl.Map | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  callback.current = onChange;
  useEffect(() => {
    if (!container.current) return;
    let alive = true,
      map: maplibregl.Map | null = null,
      resize: ResizeObserver | null = null;
    const controller = new AbortController();
    setFailed(false);
    const timer = window.setTimeout(() => {
      if (alive) {
        controller.abort();
        setFailed(true);
      }
    }, 15000);
    void fetch("https://tiles.openfreemap.org/styles/positron", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Map style unavailable");
        const style = await response.json();
        if (!alive) return;
        map = new maplibregl.Map({
          container: container.current!,
          style,
          center: [longitude, latitude],
          zoom: 14,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        const pin = new maplibregl.Marker({ color: "#1f6bff", draggable: true })
          .setLngLat([longitude, latitude])
          .addTo(map);
        marker.current = pin;
        const update = (lat: number, lng: number) => {
          pin.setLngLat([lng, lat]);
          callback.current(lat, lng);
        };
        map.on("click", (e) => update(e.lngLat.lat, e.lngLat.lng));
        pin.on("dragend", () => {
          const p = pin.getLngLat();
          update(p.lat, p.lng);
        });
        map.once("load", () => clearTimeout(timer));
        resize = new ResizeObserver(() => map?.resize());
        resize.observe(container.current!);
      })
      .catch(() => {
        if (alive) {
          clearTimeout(timer);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
      resize?.disconnect();
      map?.remove();
      mapRef.current = null;
      marker.current = null;
    };
  }, [retry]);
  useEffect(() => {
    marker.current?.setLngLat([longitude, latitude]);
    mapRef.current?.jumpTo({ center: [longitude, latitude] });
  }, [latitude, longitude]);
  return (
    <div className="point-picker">
      <div
        ref={container}
        className="point-map"
        aria-label="Choose a drop location. Coordinate inputs below provide a keyboard alternative."
      />
      {failed && (
        <div className="point-map-error" role="alert">
          <p>Map couldn’t load. Use the coordinate inputs below.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry map
          </button>
        </div>
      )}
    </div>
  );
}
