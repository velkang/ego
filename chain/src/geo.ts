export type Coordinates = { latitude: number; longitude: number };
export type LocationEvidence = Coordinates & {
  accuracy: number;
  timestamp: number;
};
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = (v: number) => (v * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude),
    dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function locationError(
  location: LocationEvidence,
  spot: Coordinates & { radius: number },
  now = Date.now(),
): string | null {
  if (
    ![
      location.latitude,
      location.longitude,
      location.accuracy,
      location.timestamp,
    ].every(Number.isFinite) ||
    Math.abs(location.latitude) > 90 ||
    Math.abs(location.longitude) > 180 ||
    location.accuracy < 0
  )
    return "INVALID_LOCATION";
  if (now - location.timestamp > 15000 || location.timestamp > now + 2000)
    return "STALE_LOCATION";
  if (location.accuracy > 50) return "LOCATION_INACCURATE";
  return distanceMeters(location, spot) <= spot.radius ? null : "TOO_FAR";
}
