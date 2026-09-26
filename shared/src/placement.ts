// Ranked placement test: a one-time solo run per minigame that unlocks ranked with a starting rating.
// It asks the same number of countries from each division's regions (Bronze's Europe, what Silver adds, …),
// so only knowing Europe can't score high. Speed doesn't count, only how many are right.
import { countriesInRegions } from './game';
import { DIVISIONS, DIVISION_IDS, START_RATING, divisionOf, type DivisionId } from './ranked';
import { REGION_OF, type RegionId } from './regions';

/** Countries asked from each division's group of regions. */
export const PLACEMENT_PER_GROUP = 6;

/** The regions each division adds to the one below (Bronze: all of its own). */
export const PLACEMENT_GROUPS = {} as Record<DivisionId, readonly RegionId[]>;
DIVISION_IDS.forEach((d, i) => {
  const below = new Set<RegionId>(i > 0 ? DIVISIONS[DIVISION_IDS[i - 1]].regions : []);
  PLACEMENT_GROUPS[d] = DIVISIONS[d].regions.filter((r) => !below.has(r));
});

export const PLACEMENT_ROUNDS = PLACEMENT_PER_GROUP * DIVISION_IDS.length;

/** Share of correct answers → starting rating, best first. The test can place you in Gold at most. */
export const PLACEMENT_BANDS: readonly { min: number; rating: number }[] = [
  { min: 0.8, rating: 1450 },
  { min: 0.65, rating: 1350 },
  { min: 0.5, rating: 1250 },
  { min: 0.35, rating: 1100 },
  { min: 0, rating: START_RATING },
];

export function placementRating(correct: number, total: number): number {
  const share = total > 0 ? correct / total : 0;
  // A tiny epsilon so 24/30 counts as 80% despite floating point.
  return (PLACEMENT_BANDS.find((b) => share + 1e-9 >= b.min) ?? PLACEMENT_BANDS[PLACEMENT_BANDS.length - 1]).rating;
}

/** Countries for a placement test: PLACEMENT_PER_GROUP per division group, easiest group first. */
export function pickPlacement(rng: () => number = Math.random): string[] {
  const out: string[] = [];
  for (const d of DIVISION_IDS) {
    const pool = countriesInRegions(PLACEMENT_GROUPS[d]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, PLACEMENT_PER_GROUP));
  }
  return out;
}

/** The division group a country belongs to. */
export function placementGroupOf(code: string): DivisionId {
  const region = REGION_OF[code];
  return DIVISION_IDS.find((d) => PLACEMENT_GROUPS[d].includes(region)) ?? 'diamond';
}

export interface PlacementResult {
  correct: number;
  total: number;
  rating: number;
  division: DivisionId;
  /** Correct answers per division group */
  groups: { division: DivisionId; correct: number; total: number }[];
}

/** Result of a finished test from its rounds (`correct` per asked country). */
export function placementResult(rounds: readonly { code: string; correct: boolean }[]): PlacementResult {
  const correct = rounds.filter((r) => r.correct).length;
  const rating = placementRating(correct, rounds.length);
  return {
    correct,
    total: rounds.length,
    rating,
    division: divisionOf(rating),
    groups: DIVISION_IDS.map((division) => {
      const inGroup = rounds.filter((r) => placementGroupOf(r.code) === division);
      return { division, correct: inGroup.filter((r) => r.correct).length, total: inGroup.length };
    }).filter((g) => g.total > 0),
  };
}
