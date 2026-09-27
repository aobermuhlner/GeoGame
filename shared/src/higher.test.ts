import { describe, expect, it } from 'vitest';
import { COUNTRY_BY_CODE } from './countries';
import { COUNTDOWN_MS, countriesInRegions } from './game';
import {
  DUEL_ROUNDS,
  DUEL_TIME_MS,
  HIGHER_ROUNDS,
  HIGHER_TIME_MS,
  STATS,
  STAT_IDS,
  applyDuelPick,
  applyDuelTimeout,
  canPair,
  compareHigher,
  dailyStat,
  decideDuel,
  duelOver,
  duelScores,
  flawlessOf,
  higherNext,
  higherOf,
  higherPick,
  higherRunView,
  newDuelRound,
  newHigherRun,
  nextDuelPair,
  pairGap,
  pairKey,
  pickDailyHigher,
  seeded,
  settleHigher,
  statValue,
  type DuelRound,
  type HigherPair,
} from './higher';
import { STAT_DATA } from './statsData';

describe('stat data', () => {
  it('covers nearly every country in every category, and only game countries', () => {
    for (const id of STAT_IDS) {
      const codes = Object.keys(STAT_DATA[id].values);
      expect(codes.length, id).toBeGreaterThanOrEqual(180);
      for (const c of codes) expect(COUNTRY_BY_CODE[c], `${id} ${c}`).toBeDefined();
      for (const v of Object.values(STAT_DATA[id].values))
        expect(Number.isFinite(v) && v >= 0, `${id} ${v}`).toBe(true);
    }
  });

  it('has sane values for well-known countries', () => {
    expect(statValue('population', 'IN')!).toBeGreaterThan(statValue('population', 'US')!);
    expect(statValue('area', 'RU')!).toBeGreaterThan(statValue('area', 'CA')!);
    expect(statValue('highestPoint', 'NP')).toBe(8849);
    expect(statValue('highestPoint', 'NL')).toBe(322);
    expect(statValue('gdp', 'US')!).toBeGreaterThan(statValue('gdp', 'CN')!);
  });

  it('formats values for display', () => {
    expect(STATS.population.format(1_406_585_000)).toBe('1.41 billion');
    expect(STATS.population.format(83_491_249)).toBe('83.5 million');
    expect(STATS.population.format(82_904)).toBe('82,904');
    expect(STATS.gdp.format(27_720_000_000_000)).toBe('$27.7 trillion');
    expect(STATS.forest.format(56.3)).toBe('56%');
    expect(STATS.forest.format(1.25)).toBe('1.3%');
    expect(STATS.area.format(0.49)).toBe('0.49 km²');
    expect(STATS.highestPoint.format(8849)).toBe('8,849 m');
  });
});

describe('pairs', () => {
  it('never pairs equal, same-looking or too-close values', () => {
    // China and Nepal share Everest.
    expect(canPair('highestPoint', 'CN', 'NP')).toBe(false);
    expect(canPair('highestPoint', 'NP', 'PK')).toBe(true);
    expect(canPair('population', 'DE', 'DE')).toBe(false);
    // Missing value (Vatican City has no GDP)
    expect(canPair('gdp', 'VA', 'DE')).toBe(false);
    // Every pair the generator makes is valid
    const rng = seeded(7);
    for (let i = 0; i < 50; i++) {
      for (const p of pickDailyHigher(STAT_IDS[i % STAT_IDS.length], rng)) {
        expect(canPair(p.stat, p.a, p.b)).toBe(true);
        const [a, b] = [statValue(p.stat, p.a)!, statValue(p.stat, p.b)!];
        expect(STATS[p.stat].format(a)).not.toBe(STATS[p.stat].format(b));
      }
    }
  });

  it('daily puzzle: a chain of 16 countries, each new one against the previous new one, getting harder', () => {
    let early = 0;
    let late = 0;
    for (const stat of STAT_IDS) {
      for (let seed = 0; seed < 5; seed++) {
        const pairs = pickDailyHigher(stat, seeded(seed * 100 + stat.length));
        expect(pairs).toHaveLength(HIGHER_ROUNDS);
        expect(new Set(pairs.flatMap((p) => [p.a, p.b])).size).toBe(HIGHER_ROUNDS + 1);
        for (let i = 1; i < pairs.length; i++) expect(pairs[i].b).toBe(pairs[i - 1].a);
        for (const p of pairs) expect(canPair(p.stat, p.a, p.b)).toBe(true);
        early += pairGap(pairs[0]) + pairGap(pairs[1]);
        late += pairGap(pairs[13]) + pairGap(pairs[14]);
      }
    }
    expect(late).toBeLessThan(early);
  });

  it('daily category is fixed per date and cycles through every category', () => {
    expect(dailyStat('2026-09-27')).toBe(dailyStat('2026-09-27'));
    const start = Date.UTC(2026, 0, 1);
    for (let cycle = 0; cycle < 3; cycle++) {
      // Align to the cycle boundary used by dailyStat (days since epoch).
      const firstDay = Math.ceil(start / 86_400_000 / STAT_IDS.length) * STAT_IDS.length + cycle * STAT_IDS.length;
      const seen = new Set(
        STAT_IDS.map((_, i) => dailyStat(new Date((firstDay + i) * 86_400_000).toISOString().slice(0, 10))),
      );
      expect(seen.size).toBe(STAT_IDS.length);
    }
  });

  it('duel pairs rotate categories and keep working in a small pool', () => {
    const pool = countriesInRegions(['north-america', 'central-america']); // 10 countries
    expect(pool).toHaveLength(10);
    const rounds: DuelRound[] = [];
    for (let i = 0; i < DUEL_ROUNDS + 20; i++) {
      const p = nextDuelPair(pool, rounds, seeded(i));
      expect(pool).toContain(p.a);
      expect(pool).toContain(p.b);
      expect(canPair(p.stat, p.a, p.b)).toBe(true);
      rounds.push({ ...newDuelRound(p, 0), end: 'done' });
    }
    // The first rounds all use different categories
    expect(new Set(rounds.slice(0, DUEL_ROUNDS).map((r) => r.pair.stat)).size).toBe(DUEL_ROUNDS);
    // No pair twice while fresh pairs exist
    const keys = rounds.slice(0, DUEL_ROUNDS).map((r) => pairKey(r.pair.a, r.pair.b));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('daily run', () => {
  const pairs = pickDailyHigher('population', seeded(1));
  const wrongOf = (p: HigherPair) => (higherOf(p) === p.a ? p.b : p.a);

  it('plays through all rounds, keeps going after a mistake, and ranks by the flawless start', () => {
    const t0 = 1_000_000;
    const run = newHigherRun('2026-09-27', 'population', pairs, t0);
    let now = t0 + COUNTDOWN_MS;
    expect(higherRunView(run, t0).phase).toBe('countdown');
    expect(higherRunView(run, t0).pair).toBeNull();
    // Too early / not one of the pair
    expect(higherPick(run, 1, higherOf(pairs[0]), t0)).toBe('ignored');
    expect(higherPick(run, 1, 'ZZ', now)).toBe('ignored');

    for (let i = 0; i < pairs.length; i++) {
      const v = higherRunView(run, now);
      expect(v.phase).toBe('playing');
      expect(v.pair).toMatchObject({ a: pairs[i].a, b: pairs[i].b });
      expect(v.pair).not.toHaveProperty('values');
      expect(v.reveal).toBeNull();
      // The carried country's value is known from the question before; the new one stays hidden.
      expect(v.known).toBe(i === 0 ? null : statValue('population', pairs[i].b));
      // Wrong on question 4, everything else right
      const pick = i === 3 ? wrongOf(pairs[i]) : higherOf(pairs[i]);
      expect(higherPick(run, i + 1, pick, now + 1000)).toBe(i === 3 ? 'wrong' : 'correct');
      expect(higherPick(run, i + 1, pick, now + 1000)).toBe('ignored'); // no second answer
      expect(higherRunView(run, now + 1000).reveal?.values).toHaveLength(2);
      now += 3000;
      higherNext(run, i + 1, now);
      higherNext(run, i + 1, now); // idempotent
    }
    const v = higherRunView(run, now);
    expect(v.phase).toBe('finished');
    expect(v.history).toHaveLength(HIGHER_ROUNDS);
    expect(v.flawless).toBe(3);
    expect(v.correct).toBe(HIGHER_ROUNDS - 1);
    expect(v.timeMs).toBe(HIGHER_ROUNDS * 1000);
  });

  it('a timeout is a mistake and ends the round at its deadline', () => {
    const t0 = 0;
    const run = newHigherRun('2026-09-27', 'population', pairs, t0);
    const late = t0 + COUNTDOWN_MS + HIGHER_TIME_MS + 5000;
    expect(settleHigher(run, late)).toBe(true);
    expect(run.rounds[0]).toMatchObject({ end: 'timeout', endedAt: COUNTDOWN_MS + HIGHER_TIME_MS, pick: null });
    expect(higherPick(run, 1, higherOf(pairs[0]), late)).toBe('ignored');
    expect(higherRunView(run, late).flawless).toBe(0);
  });

  it('flawless start beats more correct answers overall', () => {
    const ends = (wrongAt: number[]) =>
      Array.from({ length: 15 }, (_, i) => (wrongAt.includes(i + 1) ? ('wrong' as const) : ('correct' as const)));
    const score = (wrongAt: number[], timeMs = 30_000) => {
      const e = ends(wrongAt);
      return { flawless: flawlessOf(e), correct: e.filter((x) => x === 'correct').length, timeMs };
    };
    // Mistakes at 10 and 11 (9 flawless) beat a single mistake at 3 (2 flawless)…
    expect(compareHigher(score([10, 11]), score([3]))).toBeLessThan(0);
    // …but lose to a single mistake at 13 (12 flawless).
    expect(compareHigher(score([10, 11]), score([13]))).toBeGreaterThan(0);
    // Same flawless start: more correct answers, then less time.
    expect(compareHigher(score([5]), score([5, 9]))).toBeLessThan(0);
    expect(compareHigher(score([5], 20_000), score([5], 25_000))).toBeLessThan(0);
    expect(compareHigher(score([]), score([15]))).toBeLessThan(0);
  });
});

describe('duel', () => {
  const pair: HigherPair = { stat: 'population', a: 'CN', b: 'LU' };
  const right = higherOf(pair);
  const wrong = right === pair.a ? pair.b : pair.a;

  function round(p0: string | null, p1: string | null): DuelRound {
    const r = newDuelRound(pair, 0);
    r.picks = [p0, p1];
    r.end = 'done';
    r.endedAt = 1;
    return r;
  }

  it('both players get 20 s; a pick is final; the round ends when both picked', () => {
    const r = newDuelRound(pair, 0);
    expect(applyDuelPick(r, 0, 'DE', 10)).toBe(false);
    expect(applyDuelPick(r, 0, right, 10)).toBe(true);
    expect(applyDuelPick(r, 0, wrong, 20)).toBe(false);
    expect(r.end).toBeNull();
    expect(DUEL_TIME_MS).toBe(20_000);
    expect(applyDuelPick(r, 1, wrong, DUEL_TIME_MS)).toBe(false); // too late
    expect(applyDuelTimeout(r, DUEL_TIME_MS)).toBe(true);
    expect(r).toMatchObject({ end: 'timeout', picks: [right, null] });
    expect(duelScores([r])).toEqual([1, 0]);
  });

  it('always plays all 10 rounds, even when the lead can no longer be caught', () => {
    const rounds: DuelRound[] = [];
    for (let i = 0; i < DUEL_ROUNDS - 1; i++) rounds.push(round(right, wrong));
    expect(duelOver(rounds)).toBe(false); // 9:0 with 1 left
    rounds.push(round(right, wrong));
    expect(duelOver(rounds)).toBe(true);
    expect(decideDuel(rounds)).toMatchObject({ winner: 0, scores: [10, 0], wrongTotals: [0, 10], decidedBy: 'points' });
  });

  it('a tie after 10 rounds goes to sudden death until exactly one player is right', () => {
    const rounds: DuelRound[] = [];
    for (let i = 0; i < DUEL_ROUNDS; i++) rounds.push(round(i % 2 ? right : wrong, i % 2 ? wrong : right));
    expect(duelScores(rounds)).toEqual([5, 5]);
    expect(duelOver(rounds)).toBe(false);
    rounds.push(round(right, right)); // both right: go on
    expect(duelOver(rounds)).toBe(false);
    rounds.push(round(wrong, null)); // both wrong (one timed out): go on
    expect(duelOver(rounds)).toBe(false);
    rounds.push(round(wrong, right));
    expect(duelOver(rounds)).toBe(true);
    expect(decideDuel(rounds)).toMatchObject({ winner: 1, scores: [6, 7], decidedBy: 'tiebreaker' });
  });

  it('forfeit wins for the other player', () => {
    expect(decideDuel([round(right, wrong)], 0)).toMatchObject({ winner: 1, decidedBy: 'forfeit' });
  });
});
