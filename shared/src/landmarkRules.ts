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
export const PHOTO_ZOOM_MS = 15_000;

/** Zoom factor `elapsedMs` into a round: exponential, so it feels like a steady zoom-out, then the full photo. */
export function photoZoom(elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / PHOTO_ZOOM_MS));
  return Math.pow(PHOTO_START_ZOOM, 1 - t);
}
