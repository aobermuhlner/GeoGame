import { describe, expect, it } from 'vitest';
import { countriesInRegions } from './game';
import {
  DIVISION_IDS,
  DIVISIONS,
  MIN_RD,
  START_RD,
  divisionOf,
  glicko2,
  inflateRd,
  matchDivision,
  newRating,
  parseQueueMessage,
  queueWindow,
  type Rating,
} from './ranked';

const est = (rating: number): Rating => ({ rating, rd: MIN_RD, vol: 0.06 });

describe('divisions', () => {
  it('maps ratings to divisions; everyone starts in Bronze', () => {
    expect(divisionOf(newRating().rating)).toBe('bronze');
    expect(divisionOf(1199.4)).toBe('bronze');
    expect(divisionOf(1199.6)).toBe('silver'); // by the rounded (displayed) rating
    expect(divisionOf(1400)).toBe('gold');
    expect(divisionOf(1650)).toBe('platinum');
    expect(divisionOf(2400)).toBe('diamond');
  });

  it('each division adds regions, Diamond has them all', () => {
    expect(DIVISIONS.bronze.regions).toEqual(['europe']);
    expect(DIVISIONS.silver.regions).toEqual(['europe', 'south-america', 'north-america']);
    expect(DIVISIONS.gold.regions).toEqual(expect.arrayContaining(['central-america', 'asia']));
    expect(DIVISIONS.platinum.regions).toContain('africa');
    expect(DIVISIONS.platinum.regions).not.toContain('oceania');
    expect(new Set(DIVISIONS.diamond.regions).size).toBe(8);
    for (let i = 1; i < DIVISION_IDS.length; i++) {
      const lower = DIVISIONS[DIVISION_IDS[i - 1]].regions;
      expect(DIVISIONS[DIVISION_IDS[i]].regions).toEqual(expect.arrayContaining([...lower]));
    }
    for (const d of DIVISION_IDS) expect(countriesInRegions(DIVISIONS[d].regions).length).toBeGreaterThanOrEqual(10);
  });

  it('a cross-division match plays the lower division', () => {
    expect(matchDivision(1000, 1500)).toBe('bronze');
    expect(matchDivision(1850, 1450)).toBe('gold');
  });
});

describe('glicko-2', () => {
  it('new players swing a lot, established ones little', () => {
    const a = glicko2(newRating(), newRating(), 1);
    expect(a.rating - 1000).toBeGreaterThan(60);
    expect(a.rating - 1000).toBeLessThan(100);
    expect(a.rd).toBeLessThan(START_RD);

    const b = glicko2(est(1000), est(1000), 1);
    expect(b.rating - 1000).toBeGreaterThan(8);
    expect(b.rating - 1000).toBeLessThan(25);
  });

  it('is symmetric for equal players', () => {
    const w = glicko2(est(1300), est(1300), 1);
    const l = glicko2(est(1300), est(1300), 0);
    expect(w.rating - 1300).toBeCloseTo(1300 - l.rating, 6);
    expect(glicko2(est(1300), est(1300), 0.5).rating).toBeCloseTo(1300, 6);
  });

  it('losing to a stronger player costs less than losing to a weaker one', () => {
    const me = est(1400);
    const vsStronger = 1400 - glicko2(me, est(1700), 0).rating;
    const vsWeaker = 1400 - glicko2(me, est(1100), 0).rating;
    expect(vsStronger).toBeGreaterThan(0);
    expect(vsStronger).toBeLessThan(vsWeaker);

    const beatStronger = glicko2(me, est(1700), 1).rating - 1400;
    const beatWeaker = glicko2(me, est(1100), 1).rating - 1400;
    expect(beatStronger).toBeGreaterThan(beatWeaker);
    expect(beatWeaker).toBeGreaterThan(0);
  });

  it('the deviation shrinks with games but never below the floor', () => {
    let r = newRating();
    for (let i = 0; i < 200; i++) r = glicko2(r, est(r.rating), i % 2);
    expect(r.rd).toBeGreaterThanOrEqual(MIN_RD);
    expect(r.rd).toBeLessThan(MIN_RD + 5);
  });

  it('inactivity grows the deviation back, capped at the start value', () => {
    const r = est(1500);
    expect(inflateRd(r, 3_600_000).rd).toBe(MIN_RD);
    expect(inflateRd(r, 30 * 86_400_000).rd).toBeGreaterThan(MIN_RD);
    expect(inflateRd(r, 1e6 * 86_400_000).rd).toBe(START_RD);
  });
});

describe('queue', () => {
  it('the rating window widens with waiting', () => {
    expect(queueWindow(0)).toBe(150);
    expect(queueWindow(10_000)).toBeGreaterThan(queueWindow(2_000));
  });

  it('parses queue messages', () => {
    const token = 'a'.repeat(64);
    expect(parseQueueMessage(JSON.stringify({ t: 'queue', token, mode: 'capitals' }))).toEqual({ t: 'queue', token, mode: 'capitals' });
    expect(parseQueueMessage(JSON.stringify({ t: 'queue', token, mode: 'chess' }))).toBeNull();
    expect(parseQueueMessage(JSON.stringify({ t: 'queue', token: 'x', mode: 'flags' }))).toBeNull();
    expect(parseQueueMessage('{"t":"cancel"}')).toEqual({ t: 'cancel' });
    expect(parseQueueMessage('nope')).toBeNull();
  });
});
