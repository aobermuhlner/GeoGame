import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  REGION_IDS,
  REGION_OF,
  applyGuess,
  applyPass,
  applyTimeout,
  countriesInRegions,
  decideMatch,
  isCorrectGuess,
  newRound,
  normalize,
  pickFlags,
  resolveGuess,
  suggestCountries,
  ROUND_TIME_MS,
  type RoundState,
} from './index';

describe('country data', () => {
  it('has 193 UN members + VA, PS, XK, TW', () => {
    expect(COUNTRIES).toHaveLength(197);
    for (const c of ['VA', 'PS', 'XK', 'TW']) expect(COUNTRIES.some((x) => x.code === c)).toBe(true);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(197);
  });
  it('every region table entry is a country', () => {
    expect(Object.keys(REGION_OF).sort()).toEqual(COUNTRIES.map((c) => c.code).sort());
  });
  it('transcontinental assignments', () => {
    expect(REGION_OF.RU).toBe('europe');
    expect(REGION_OF.CY).toBe('europe');
    expect(REGION_OF.TR).toBe('asia');
    expect(REGION_OF.KZ).toBe('asia');
    expect(REGION_OF.EG).toBe('africa');
    for (const c of ['GE', 'AM', 'AZ']) expect(REGION_OF[c]).toBe('asia');
  });
});

describe('guess normalization', () => {
  it('is case, accent, whitespace and punctuation insensitive', () => {
    expect(normalize('  Côte d’Ivoire ')).toBe('cote divoire');
    expect(isCorrectGuess('COTE D IVOIRE', 'CI')).toBe(false); // spacing inside a word matters
    expect(isCorrectGuess("cote d'ivoire", 'CI')).toBe(true);
    expect(isCorrectGuess('  germany ', 'DE')).toBe(true);
    expect(isCorrectGuess('Sao Tome and Principe', 'ST')).toBe(true);
    expect(isCorrectGuess('São Tomé & Príncipe', 'ST')).toBe(true);
  });
  it('accepts aliases', () => {
    expect(isCorrectGuess('USA', 'US')).toBe(true);
    expect(isCorrectGuess('u.s.a.', 'US')).toBe(true);
    expect(isCorrectGuess('United States of America', 'US')).toBe(true);
    expect(isCorrectGuess('Czech Republic', 'CZ')).toBe(true);
    expect(isCorrectGuess('czechia', 'CZ')).toBe(true);
    expect(isCorrectGuess('Ivory Coast', 'CI')).toBe(true);
    expect(isCorrectGuess('UK', 'GB')).toBe(true);
    expect(isCorrectGuess('St Lucia', 'LC')).toBe(true);
    expect(isCorrectGuess('St. Kitts & Nevis', 'KN')).toBe(true);
    expect(isCorrectGuess('The Gambia', 'GM')).toBe(true);
    expect(isCorrectGuess('Gambia', 'GM')).toBe(true);
  });
  it('rejects non-aliases and wrong countries', () => {
    expect(isCorrectGuess('Holland', 'NL')).toBe(false);
    expect(isCorrectGuess('Austria', 'AU')).toBe(false);
    expect(isCorrectGuess('Niger', 'NG')).toBe(false);
    expect(isCorrectGuess('', 'DE')).toBe(false);
    expect(resolveGuess('Atlantis')).toBeNull();
  });
});

describe('autocomplete', () => {
  it('puts prefix matches before word-start matches', () => {
    expect(suggestCountries('ba', 10)).toEqual([
      'Bahamas',
      'Bahrain',
      'Bangladesh',
      'Barbados',
      'Antigua and Barbuda',
    ]);
  });
  it('finds countries via alias', () => {
    expect(suggestCountries('usa')[0]).toBe('United States');
    expect(suggestCountries('ivory')[0]).toBe("Côte d'Ivoire");
  });
  it('ranks exact alias/name matches first', () => {
    expect(suggestCountries('uk')[0]).toBe('United Kingdom');
    expect(suggestCountries('niger').slice(0, 2)).toEqual(['Niger', 'Nigeria']);
  });
  it('is empty for empty query', () => {
    expect(suggestCountries('   ')).toEqual([]);
  });
});

describe('flag selection', () => {
  it('only picks from selected regions, without duplicates', () => {
    for (let n = 0; n < 50; n++) {
      const flags = pickFlags(['oceania', 'caribbean'], 10);
      expect(flags).toHaveLength(10);
      expect(new Set(flags).size).toBe(10);
      for (const f of flags) expect(['oceania', 'caribbean']).toContain(REGION_OF[f]);
    }
  });
  it('returns fewer flags when the pool is small', () => {
    expect(pickFlags(['north-america'], 10).sort()).toEqual(['CA', 'MX', 'US']);
  });
  it('region counts add up', () => {
    const total = REGION_IDS.reduce((n, r) => n + countriesInRegions([r]).length, 0);
    expect(total).toBe(197);
  });
});

describe('round resolution', () => {
  const t0 = 1_000_000;
  let r: RoundState;
  const fresh = () => (r = newRound('DE', t0));

  it('first correct guess wins and ends the round', () => {
    fresh();
    expect(applyGuess(r, 1, 'France', t0 + 100)).toBe('wrong');
    expect(applyGuess(r, 0, 'Germany', t0 + 200)).toBe('correct');
    expect(r.winner).toBe(0);
    expect(r.end).toBe('correct');
    expect(r.wrong).toEqual([0, 1]);
  });
  it('simultaneous correct guesses: arrival order decides, second is ignored', () => {
    fresh();
    expect(applyGuess(r, 1, 'germany', t0 + 500)).toBe('correct');
    expect(applyGuess(r, 0, 'Germany', t0 + 500)).toBe('ignored');
    expect(r.winner).toBe(1);
  });
  it('both pass → no point', () => {
    fresh();
    expect(applyPass(r, 0, t0 + 10)).toBe(false);
    expect(r.end).toBeNull();
    expect(applyGuess(r, 1, 'Spain', t0 + 20)).toBe('wrong');
    expect(applyPass(r, 1, t0 + 30)).toBe(true);
    expect(r.end).toBe('passed');
    expect(r.winner).toBeNull();
  });
  it('a player who passed can still be beaten by the other', () => {
    fresh();
    applyPass(r, 0, t0 + 10);
    expect(applyGuess(r, 0, 'Germany', t0 + 15)).toBe('ignored');
    expect(applyGuess(r, 1, 'Germany', t0 + 20)).toBe('correct');
    expect(r.winner).toBe(1);
  });
  it('timeout → no point, late guesses ignored', () => {
    fresh();
    expect(applyTimeout(r, t0 + ROUND_TIME_MS - 1)).toBe(false);
    expect(applyGuess(r, 0, 'Germany', t0 + ROUND_TIME_MS)).toBe('ignored');
    expect(r.end).toBe('timeout');
    expect(r.winner).toBeNull();
    expect(applyTimeout(r, t0 + ROUND_TIME_MS + 5)).toBe(false);
  });
});

describe('match decision', () => {
  const round = (winner: 0 | 1 | null, wrong: [number, number]): RoundState => ({
    ...newRound('DE', 0),
    winner,
    wrong,
    end: winner === null ? 'timeout' : 'correct',
  });

  it('most points wins', () => {
    const res = decideMatch([round(0, [3, 0]), round(0, [0, 0]), round(1, [0, 0])]);
    expect(res).toMatchObject({ winner: 0, scores: [2, 1], decidedBy: 'points' });
  });
  it('tie on points → fewer wrong guesses wins', () => {
    const res = decideMatch([round(0, [2, 1]), round(1, [0, 4])]);
    expect(res).toMatchObject({ winner: 0, wrongTotals: [2, 5], decidedBy: 'tiebreaker' });
  });
  it('tie on points and wrong guesses → draw', () => {
    const res = decideMatch([round(0, [1, 0]), round(1, [0, 1]), round(null, [0, 0])]);
    expect(res).toMatchObject({ winner: null, decidedBy: 'draw' });
  });
  it('forfeit gives the win to the opponent regardless of score', () => {
    const res = decideMatch([round(0, [0, 0])], 0);
    expect(res).toMatchObject({ winner: 1, decidedBy: 'forfeit' });
  });
});
