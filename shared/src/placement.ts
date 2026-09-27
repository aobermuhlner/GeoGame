// Ranked placement test: a one-time solo run per minigame that unlocks ranked with a starting rating.
// It asks the same number of countries from each division's tier (Bronze's 40 best-known countries, the 40
// Silver adds, …), so only knowing the famous ones can't score high. Speed doesn't count, only how many are right.
import { DIVISIONS, DIVISION_IDS, START_RATING, divisionOf, tierOf, type DivisionId } from './ranked';

/** Countries asked from each division's tier. */
export const PLACEMENT_PER_GROUP = 6;

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

/** Countries for a placement test: PLACEMENT_PER_GROUP per division tier, easiest tier first. */
export function pickPlacement(rng: () => number = Math.random): string[] {
  const out: string[] = [];
  for (const d of DIVISION_IDS) {
    const pool = [...DIVISIONS[d].tier];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, PLACEMENT_PER_GROUP));
  }
  return out;
}

/** The division tier a country belongs to. */
export const placementGroupOf = (code: string): DivisionId => tierOf(code);

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
