import { describe, expect, it } from 'vitest';
import { COUNTRY_BY_CODE } from './countries';
import { CAPITAL_BY_CODE } from './capitals';
import { COUNTDOWN_MS, ROUND_TIME_MS } from './game';
import {
  SOLO_MAX_SCORE,
  dailyView,
  dayOf,
  newDailyRun,
  nextDayAt,
  settleRun,
  soloGuess,
  soloNext,
  soloPass,
  soloPoints,
} from './daily';

const CODES = ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'CH', 'PL'];
const T0 = Date.UTC(2026, 8, 26, 12);
const START = T0 + COUNTDOWN_MS;

describe('daily run', () => {
  it('scores speed and penalises wrong guesses', () => {
    expect(soloPoints(0, 0)).toBe(100);
    expect(soloPoints(ROUND_TIME_MS / 2, 0)).toBe(75);
    expect(soloPoints(ROUND_TIME_MS / 2, 2)).toBe(65);
    expect(soloPoints(ROUND_TIME_MS, 20)).toBe(10);
    expect(SOLO_MAX_SCORE).toBe(1000);
  });

  it('counts down, then plays; guesses before the start are ignored', () => {
    const run = newDailyRun('2026-09-26', 'flags', CODES, T0, 'tok0');
    expect(dailyView(run, T0).phase).toBe('countdown');
    expect(dailyView(run, T0).flag).toBeNull();
    expect(soloGuess(run, 1, 'France', T0 + 10)).toBe('ignored');
    const v = dailyView(run, START);
    expect(v).toMatchObject({ phase: 'playing', flag: 'tok0', round: 1, totalRounds: 10, prompt: null });
  });

  it('correct → reveal → next round; the answer is only shown after the round', () => {
    const run = newDailyRun('2026-09-26', 'flags', CODES, T0, 'tok0');
    expect(soloGuess(run, 1, 'Atlantis', START + 1000)).toBe('wrong');
    expect(soloGuess(run, 1, 'france', START + 2000)).toBe('correct');
    const v = dailyView(run, START + 2000);
    expect(v.phase).toBe('reveal');
    expect(v.reveal).toMatchObject({ answer: 'France', end: 'correct', wrong: 1, points: soloPoints(2000, 1) });
    expect(v.score).toBe(soloPoints(2000, 1));

    expect(soloGuess(run, 1, 'france', START + 2100)).toBe('ignored');
    expect(soloNext(run, 1, START + 4000, 'tok1')).toBe(true);
    expect(soloNext(run, 1, START + 4001, 'tokX')).toBe(false); // idempotent
    const v2 = dailyView(run, START + 4000);
    expect(v2).toMatchObject({ phase: 'playing', round: 2, flag: 'tok1', reveal: null });
    expect(v2.history).toHaveLength(1);
  });

  it('times out at the deadline even when noticed late', () => {
    const run = newDailyRun('2026-09-26', 'flags', CODES, T0, 'tok0');
    expect(settleRun(run, START + ROUND_TIME_MS - 1)).toBe(false);
    expect(soloGuess(run, 1, 'France', START + ROUND_TIME_MS + 5000)).toBe('ignored');
    expect(run.rounds[0]).toMatchObject({ end: 'timeout', endedAt: START + ROUND_TIME_MS, points: 0 });
  });

  it('finishes after the last round and totals the score', () => {
    const run = newDailyRun('2026-09-26', 'capitals', CODES, T0, 'tok0');
    let now = START;
    for (let i = 0; i < CODES.length; i++) {
      if (i > 0) expect(soloNext(run, i, now, `tok${i}`)).toBe(true);
      if (i % 2 === 0) expect(soloGuess(run, i + 1, CAPITAL_BY_CODE[CODES[i]].name, now)).toBe('correct');
      else expect(soloPass(run, i + 1, now)).toBe(true);
      now += 1000;
    }
    expect(run.finishedAt).not.toBeNull();
    expect(run.score).toBe(5 * 100);
    expect(soloNext(run, 10, now, 'tok10')).toBe(false);
    const v = dailyView(run, now);
    expect(v.phase).toBe('finished');
    expect(v.history.map((h) => h.countryName)).toEqual(CODES.map((c) => COUNTRY_BY_CODE[c].name));
  });

  it('capitals show the country while playing', () => {
    const run = newDailyRun('2026-09-26', 'capitals', CODES, T0, 'tok0');
    expect(dailyView(run, START).prompt).toBe('France');
  });

  it('days are UTC', () => {
    expect(dayOf(Date.UTC(2026, 8, 26, 23, 59))).toBe('2026-09-26');
    expect(nextDayAt(Date.UTC(2026, 8, 26, 23, 59))).toBe(Date.UTC(2026, 8, 27));
  });
});

describe('daily GeoLocate', () => {
  it('ends the round with no points after the last try', () => {
    const run = newDailyRun('2026-09-26', 'locate', CODES, T0, 'tok');
    expect(soloGuess(run, 1, 'DE', START + 100)).toBe('wrong');
    expect(soloGuess(run, 1, 'IT', START + 200)).toBe('wrong');
    expect(run.rounds[0].end).toBeNull();
    expect(soloGuess(run, 1, 'ES', START + 300)).toBe('wrong');
    expect(run.rounds[0].end).toBe('passed');
    expect(run.rounds[0].points).toBe(-15);
    expect(run.score).toBe(-15);
    expect(soloGuess(run, 1, 'FR', START + 400)).toBe('ignored');
    const v = dailyView(run, START + 500);
    expect(v.reveal?.code).toBe('FR');
    expect(v.prompt).toBeNull();
  });

  it('wrong clicks cost points on a pass or timeout too', () => {
    const run = newDailyRun('2026-09-26', 'locate', CODES, T0, 'tok');
    soloGuess(run, 1, 'DE', START + 100);
    soloPass(run, 1, START + 200);
    expect(run.rounds[0].points).toBe(-5);
    soloNext(run, 1, START + 300, 'tok2');
    soloGuess(run, 2, 'FR', START + 400);
    settleRun(run, START + 300 + ROUND_TIME_MS);
    expect(run.rounds[1].end).toBe('timeout');
    expect(run.score).toBe(-10);
  });

  it('text modes: wrong guesses only reduce a correct answer', () => {
    const run = newDailyRun('2026-09-26', 'flags', CODES, T0, 'tok');
    soloGuess(run, 1, 'Spain', START + 100);
    soloPass(run, 1, START + 200);
    expect(run.rounds[0].points).toBe(0);
  });

  it('shows the country name while playing and scores a correct click', () => {
    const run = newDailyRun('2026-09-26', 'locate', CODES, T0, 'tok');
    expect(dailyView(run, START + 1).prompt).toBe(COUNTRY_BY_CODE.FR.name);
    expect(soloGuess(run, 1, 'FR', START)).toBe('correct');
    expect(run.rounds[0].points).toBe(100);
  });
});
