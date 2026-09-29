import { describe, expect, it } from 'vitest';
import {
  GROUP_BASE_POINTS,
  GROUP_SPEED_POINTS,
  groupGuess,
  groupPass,
  groupPick,
  groupPoints,
  newGroupRound,
  pickGroupPairs,
  ranksOf,
  settleGroupRound,
  tallyOf,
} from './group';
import { COUNTRIES } from './countries';
import { higherOf } from './higher';
import { ROUND_TIME_MS } from './game';

const T0 = 1_000_000;

describe('group points', () => {
  it('rewards speed and correctness', () => {
    expect(groupPoints(0, ROUND_TIME_MS, 0)).toBe(GROUP_BASE_POINTS + GROUP_SPEED_POINTS);
    expect(groupPoints(ROUND_TIME_MS / 2, ROUND_TIME_MS, 0)).toBe(75);
    expect(groupPoints(ROUND_TIME_MS, ROUND_TIME_MS, 0)).toBe(GROUP_BASE_POINTS);
    expect(groupPoints(ROUND_TIME_MS, ROUND_TIME_MS, 20)).toBe(10);
  });
});

describe('group rounds', () => {
  it('lets every player answer a flag; each wrong try costs a little', () => {
    const r = newGroupRound('flags', 'DE', null, 3, T0);
    expect(groupGuess(r, 0, 'Germany', T0 + 2000)).toBe('correct');
    expect(groupGuess(r, 1, 'Austria', T0 + 3000)).toBe('wrong');
    expect(groupGuess(r, 1, 'germany', T0 + 4000)).toBe('correct');
    expect(groupGuess(r, 0, 'Germany', T0 + 5000)).toBe('ignored');
    expect(r.entries[0].points).toBe(groupPoints(2000, ROUND_TIME_MS, 0));
    expect(r.entries[1].points).toBe(groupPoints(4000, ROUND_TIME_MS, 1));
    expect(r.entries[0].points).toBeGreaterThan(r.entries[1].points);
    // Player 2 hasn't answered: the round waits for them…
    expect(settleGroupRound(r, [true, true, true], T0 + 5000)).toBe(false);
    // …unless they're gone.
    expect(settleGroupRound(r, [true, true, false], T0 + 5000)).toBe(true);
    expect(r.entries[2].points).toBe(0);
  });

  it('ends when everyone is done, or at the deadline', () => {
    const r = newGroupRound('flags', 'FR', null, 2, T0);
    groupPass(r, 0, T0 + 100);
    expect(settleGroupRound(r, [true, true], T0 + 200)).toBe(false);
    expect(settleGroupRound(r, [true, true], T0 + ROUND_TIME_MS)).toBe(true);
    expect(r.endedAt).toBe(T0 + ROUND_TIME_MS);
  });

  it('takes one final answer per player in lock-in games, refusing typos', () => {
    const r = newGroupRound('languages', 'spa.1', null, 2, T0);
    expect(groupGuess(r, 0, 'xyzzy', T0 + 100)).toBe('invalid');
    expect(groupGuess(r, 0, 'Italian', T0 + 200)).toBe('locked');
    expect(groupGuess(r, 0, 'Spanish', T0 + 300)).toBe('ignored');
    expect(groupGuess(r, 1, 'Spanish', T0 + 400)).toBe('locked');
    expect(r.entries[0]).toMatchObject({ end: 'wrong', answer: 'Italian', points: 0 });
    expect(r.entries[1].end).toBe('correct');
    expect(r.entries[1].points).toBeGreaterThan(90);
  });

  it('scores Higher or Lower picks on correctness and speed', () => {
    const [pair] = pickGroupPairs(
      COUNTRIES.map((c) => c.code),
      1,
    );
    const r = newGroupRound('higher', '', pair, 2, T0);
    const right = higherOf(pair);
    const wrong = right === pair.a ? pair.b : pair.a;
    expect(groupPick(r, 0, 'ZZ', T0 + 10)).toBe(false);
    expect(groupPick(r, 0, right, T0 + 1000)).toBe(true);
    expect(groupPick(r, 0, wrong, T0 + 1100)).toBe(false);
    expect(groupPick(r, 1, wrong, T0 + 1200)).toBe(true);
    expect(r.entries[0].points).toBeGreaterThan(90);
    expect(r.entries[1].points).toBe(0);
    expect(settleGroupRound(r, [true, true], T0 + 1300)).toBe(true);
  });

  it('draws distinct Higher or Lower pairs', () => {
    const pairs = pickGroupPairs(
      COUNTRIES.map((c) => c.code),
      8,
    );
    expect(pairs).toHaveLength(8);
    expect(new Set(pairs.map((p) => [p.a, p.b].sort().join())).size).toBe(8);
  });
});

describe('ranking', () => {
  it('ranks by points, then right answers, then time; exact ties share a rank', () => {
    const a = newGroupRound('flags', 'DE', null, 4, T0);
    groupGuess(a, 0, 'Germany', T0 + 1000);
    groupGuess(a, 1, 'Germany', T0 + 1000);
    groupGuess(a, 2, 'Germany', T0 + 9000);
    settleGroupRound(a, [true, true, true, true], T0 + ROUND_TIME_MS);
    const t = tallyOf([a], 4);
    expect(t[0]).toEqual(t[1]);
    expect(ranksOf(t)).toEqual([1, 1, 3, 4]);
  });
});
