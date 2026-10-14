import type { LocationEvidence } from "@ego/chain";
export function locationMessage(error: GeolocationPositionError) {
  return error.code === 1
    ? "Allow location access in your browser settings to find nearby drops."
    : error.code === 3
      ? "Finding your location took too long. Try again outside or near a window."
      : "Your location is unavailable. Try again in an open area.";
}
export const evidence = (position: GeolocationPosition): LocationEvidence => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy,
  timestamp: position.timestamp,
});
export function freshLocation(): Promise<LocationEvidence> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error("Your browser does not support location access."),
      );
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(evidence(p)),
      (e) => reject(new Error(locationMessage(e))),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}
export function formatDistance(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function trackLocation(
  onPosition: (position: LocationEvidence) => void,
  onError: (message: string) => void,
) {
  if (!navigator.geolocation) {
    onError("Your browser does not support location access.");
    return () => {};
  }
  let watch: number | null = null;
  let active = true;
  const stop = () => {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
  };
  const start = () => {
    stop();
    if (document.hidden || !active) return;
    watch = navigator.geolocation.watchPosition(
      (position) => {
        if (active) onPosition(evidence(position));
      },
      (error) => {
        if (active) onError(locationMessage(error));
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
  };
  const visibility = () => {
    if (document.hidden) stop();
    else start();
  };
  start();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    active = false;
    stop();
    document.removeEventListener("visibilitychange", visibility);
  };
}
