import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_BANDS,
  PLACEMENT_GROUPS,
  PLACEMENT_PER_GROUP,
  PLACEMENT_ROUNDS,
  pickPlacement,
  placementGroupOf,
  placementRating,
  placementResult,
} from './placement';
import { DIVISION_IDS, START_RATING, divisionOf } from './ranked';
import { REGION_IDS } from './regions';

describe('placement test', () => {
  it('groups every region exactly once, by the division that adds it', () => {
    const all = DIVISION_IDS.flatMap((d) => PLACEMENT_GROUPS[d]);
    expect([...all].sort()).toEqual([...REGION_IDS].sort());
    expect(PLACEMENT_GROUPS.bronze).toEqual(['europe']);
    expect(PLACEMENT_GROUPS.platinum).toEqual(['africa']);
  });

  it('asks the same number of countries from each group, easiest first, no repeats', () => {
    const codes = pickPlacement();
    expect(codes).toHaveLength(PLACEMENT_ROUNDS);
    expect(new Set(codes).size).toBe(codes.length);
    DIVISION_IDS.forEach((d, i) => {
      const slice = codes.slice(i * PLACEMENT_PER_GROUP, (i + 1) * PLACEMENT_PER_GROUP);
      expect(slice.every((c) => placementGroupOf(c) === d)).toBe(true);
    });
  });

  it('maps the share of correct answers to a starting rating', () => {
    expect(placementRating(0, 30)).toBe(START_RATING);
    expect(placementRating(10, 30)).toBe(START_RATING); // 33%
    expect(placementRating(11, 30)).toBe(1100); // 37%
    expect(placementRating(15, 30)).toBe(1250); // 50%
    expect(placementRating(20, 30)).toBe(1350); // 67%
    expect(placementRating(23, 30)).toBe(1350); // 77%
    expect(placementRating(24, 30)).toBe(1450); // 80%
    expect(placementRating(30, 30)).toBe(1450);
    expect(divisionOf(placementRating(15, 30))).toBe('silver');
  });

  it('never places above Gold', () => {
    const best = Math.max(...PLACEMENT_BANDS.map((b) => b.rating));
    expect(divisionOf(best)).toBe('gold');
  });

  it('summarises a finished test per division group', () => {
    const codes = pickPlacement();
    // Everything right except the Platinum and Diamond groups.
    const rounds = codes.map((code) => ({ code, correct: !['platinum', 'diamond'].includes(placementGroupOf(code)) }));
    const r = placementResult(rounds);
    expect(r).toMatchObject({ correct: 18, total: 30, rating: 1250, division: 'silver' });
    expect(r.groups).toEqual(
      DIVISION_IDS.map((division, i) => ({ division, correct: i < 3 ? PLACEMENT_PER_GROUP : 0, total: PLACEMENT_PER_GROUP })),
    );
  });
});
