import { COUNTRY_BY_CODE } from './countries';
import { LANDMARK_META } from './landmarkMeta';
import { LANDMARKS, type Landmark } from './landmarks';
import { REGION_OF, type RegionId } from './regions';

for (const l of LANDMARKS) {
  if (!COUNTRY_BY_CODE[l.country]) throw new Error(`Landmark ${l.id}: unknown country ${l.country}`);
  if (!LANDMARK_META[l.id]) throw new Error(`Landmark ${l.id}: no photo yet (run worker/scripts/fetch-landmarks.mjs)`);
}

export const LANDMARK_BY_ID: Record<string, Landmark> = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

/** Ids of the landmarks in the selected regions. */
export function landmarksInRegions(regions: readonly RegionId[]): string[] {
  const set = new Set(regions);
  return LANDMARKS.filter((l) => set.has(REGION_OF[l.country])).map((l) => l.id);
}

/** Where the zoom starts: the photo's focus point (fractions of width and height). */
export const focusOf = (id: string): [number, number] => LANDMARK_BY_ID[id]?.focus ?? [0.5, 0.5];

/** How far in a landmark round starts (times the full photo), and how long it takes to zoom all the way out. */
export const PHOTO_START_ZOOM = 5;
export const PHOTO_ZOOM_MS = 25_000;
/**
 * Once 60% of the photo's width shows (zoom 1/0.6), the zoom-out slows down: the first part takes
 * PHOTO_SLOW_AT_MS, the last 40% the rest of PHOTO_ZOOM_MS (about 3× slower), so the whole photo only shows
 * for the round's last 5 seconds.
 */
export const PHOTO_SLOW_ZOOM = 1 / 0.6;
export const PHOTO_SLOW_AT_MS = 10_000;

/** Zoom factor `elapsedMs` into a round: exponential (a steady zoom-out) in two speeds, then the full photo. */
export function photoZoom(elapsedMs: number): number {
  const t = Math.max(0, Math.min(PHOTO_ZOOM_MS, elapsedMs));
  if (t < PHOTO_SLOW_AT_MS) return PHOTO_START_ZOOM * Math.pow(PHOTO_SLOW_ZOOM / PHOTO_START_ZOOM, t / PHOTO_SLOW_AT_MS);
  return Math.pow(PHOTO_SLOW_ZOOM, 1 - (t - PHOTO_SLOW_AT_MS) / (PHOTO_ZOOM_MS - PHOTO_SLOW_AT_MS));
}
