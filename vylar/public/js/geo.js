// Geospatial helpers (WGS84 approximations — fine at site scale).
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearingDeg(from, to) {
  const y = Math.sin(rad(to.lng - from.lng)) * Math.cos(rad(to.lat));
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lng - from.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Signed smallest difference between two bearings, in (-180, 180].
export function bearingDelta(from, to) {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function formatDistance(m) {
  return m < 950 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function compassPoint(bearing) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(bearing / 45) % 8];
}

// Offset a coordinate by meters north/east (small-distance approximation).
export function offsetM(pos, northM, eastM) {
  return {
    lat: pos.lat + deg(northM / R),
    lng: pos.lng + deg(eastM / (R * Math.cos(rad(pos.lat)))),
  };
}
