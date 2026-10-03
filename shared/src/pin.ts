// Landmarks game: the answer is a pin on the world map plus a radius around it. The landmark has to lie
// inside the circle; a smaller circle is worth more points.
//
// A pin answer travels as text like any other guess: "lat,lon,km" (degrees, 3 decimals; km = one of PIN_RADII).
import { LANDMARK_META } from './landmarkMeta';

/** Radius choices (km), smallest first, and what a right answer with each is worth in a 1 vs 1 duel. */
export const PIN_RADII = [100, 250, 500, 1000, 2000] as const;
export const PIN_POINTS = [5, 4, 3, 2, 1] as const;
export const PIN_MAX_POINTS = PIN_POINTS[0];
/** Radius selected when a round starts */
export const PIN_DEFAULT_RADIUS = 500;

export interface Pin {
  lat: number;
  lon: number;
  km: number;
}

const R_EARTH = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** "48.858,2.295,250" */
export function formatPin(p: Pin): string {
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)},${p.km}`;
}

/** Parses a pin answer; null if it isn't one (or the radius isn't one of PIN_RADII). */
export function parsePin(text: string): Pin | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(\d{1,5})\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  const km = Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(PIN_RADII as readonly number[]).includes(km)) return null;
  return { lat, lon, km };
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The point `km` away from (lat, lon) in direction `bearing` (degrees from north): [lat, lon]. */
export function destination(lat: number, lon: number, km: number, bearing: number): [number, number] {
  const d = km / R_EARTH;
  const p1 = rad(lat);
  const b = rad(bearing);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

/** How far (km) a pin answer is from the landmark; null if either is unknown. */
export function pinMissKm(answer: string, landmark: string): number | null {
  const p = parsePin(answer);
  const m = LANDMARK_META[landmark];
  if (!p || !m || m.lat === null || m.lon === null) return null;
  return distanceKm(p.lat, p.lon, m.lat, m.lon);
}

export function isPinCorrect(answer: string, landmark: string): boolean {
  const p = parsePin(answer);
  const miss = pinMissKm(answer, landmark);
  return !!p && miss !== null && miss <= p.km;
}

/** Duel points for a right answer with this pin's radius (0 if it isn't a pin). */
export function pinPoints(answer: string): number {
  const p = parsePin(answer);
  const i = p ? (PIN_RADII as readonly number[]).indexOf(p.km) : -1;
  return i < 0 ? 0 : PIN_POINTS[i];
}

/** "312 km" / "1,250 km" */
export const formatKm = (km: number) => `${Math.round(km).toLocaleString('en-US')} km`;

// ---------- Natural Earth projection (the GeoLocate map's, see frontend/scripts/gen-locate-map.mjs) ----------

/** d3's geoNaturalEarth1 as generated: screen = [tx + k·x, ty − k·y] of the raw projection of (lon + rot). */
export interface MapProjection {
  k: number;
  tx: number;
  ty: number;
  /** Degrees added to the longitude before projecting */
  rot: number;
  /**
   * The Pacific east of the seam (longitudes west…east, south of `north`) is drawn past the map's right edge,
   * the projection continued one turn further east. Its normal place, at the left edge, stays empty.
   */
  east?: { west: number; east: number; north: number };
}

const inEast = (p: MapProjection, lat: number, lon: number) =>
  !!p.east && lon >= p.east.west && lon <= p.east.east && lat < p.east.north;

function ne1(lambda: number, phi: number): [number, number] {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

function ne1Invert(x: number, y: number): [number, number] {
  let phi = y;
  let delta = 0;
  let i = 25;
  do {
    const phi2 = phi * phi;
    const phi4 = phi2 * phi2;
    delta =
      (phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))) - y) /
      (1.007226 + phi2 * (0.015085 * 3 + phi4 * (-0.044475 * 7 + 0.028874 * 9 * phi2 - 0.005916 * 11 * phi4)));
    phi -= delta;
  } while (Math.abs(delta) > 1e-6 && --i > 0);
  const phi2 = phi * phi;
  return [x / (0.8707 + phi2 * (-0.131979 + phi2 * (-0.013791 + phi2 * phi2 * phi2 * (0.003971 - 0.001529 * phi2)))), phi];
}

const wrap180 = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * [lat, lon] → map units. With `nearX`, of the point's two possible places (the normal one and one turn
 * further east) the one closer to that x: keeps a circle around a pin in one piece near the east zone.
 */
export function project(p: MapProjection, lat: number, lon: number, nearX?: number): [number, number] {
  const l = wrap180(lon + p.rot);
  const at = (deg: number): [number, number] => {
    const [x, y] = ne1(rad(deg), rad(lat));
    return [p.tx + p.k * x, p.ty - p.k * y];
  };
  if (!p.east || l > 0) return at(l);
  if (nearX === undefined) return at(inEast(p, lat, wrap180(lon)) ? l + 360 : l);
  const [a, b] = [at(l), at(l + 360)];
  return Math.abs(a[0] - nearX) <= Math.abs(b[0] - nearX) ? a : b;
}

/** Map units → [lat, lon], or null off the globe's outline. */
export function unproject(p: MapProjection, mx: number, my: number): [number, number] | null {
  const [lambda, phi] = ne1Invert((mx - p.tx) / p.k, (p.ty - my) / p.k);
  const lat = deg(phi);
  const lon = deg(lambda);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || lon < -180) return null;
  // Past the seam only the east zone is drawn; its normal place at the left edge is empty map.
  const real = wrap180(lon - p.rot);
  if (lon > 180 ? !inEast(p, lat, real) || lon > 360 : inEast(p, lat, real)) return null;
  return [lat, real];
}
