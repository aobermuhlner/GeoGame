// Pure game rules shared by the Durable Object (authoritative) and the local mock.
import { COUNTRIES } from './countries';
import { isCorrectGuess } from './normalize';
import type { RegionId } from './regions';

export const ROUNDS_PER_GAME = 10;
export const ROUND_TIME_MS = 20_000;
export const REVEAL_MS = 2_500;
export const COUNTDOWN_MS = 3_000;
export const RECONNECT_GRACE_MS = 20_000;

/** Player seat: 0 = host, 1 = guest. */
export type Slot = 0 | 1;

export type RoundEnd = 'correct' | 'passed' | 'timeout' | 'forfeit';

export interface RoundState {
  /** ISO code of the answer — never sent to clients before the round ends. */
  code: string;
  startedAt: number;
  deadline: number;
  wrong: [number, number];
  passed: [boolean, boolean];
  winner: Slot | null;
  /** Set once the round is over. */
  end: RoundEnd | null;
  endedAt: number | null;
}

export function countriesInRegions(regions: readonly RegionId[]): string[] {
  const set = new Set(regions);
  return COUNTRIES.filter((c) => set.has(c.region)).map((c) => c.code);
}

/** Pick `count` distinct flags from the selected regions (Fisher–Yates). */
export function pickFlags(
  regions: readonly RegionId[],
  count = ROUNDS_PER_GAME,
  rng: () => number = Math.random,
): string[] {
  const pool = countriesInRegions(regions);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

export function newRound(code: string, now: number): RoundState {
  return {
    code,
    startedAt: now,
    deadline: now + ROUND_TIME_MS,
    wrong: [0, 0],
    passed: [false, false],
    winner: null,
    end: null,
    endedAt: null,
  };
}

export type GuessOutcome = 'correct' | 'wrong' | 'ignored';

/**
 * Apply a guess in arrival order. The first correct guess to arrive ends the
 * round; anything arriving after that (or from a player who passed) is ignored.
 * Mutates `round`.
 */
export function applyGuess(round: RoundState, slot: Slot, text: string, now: number): GuessOutcome {
  if (round.end || round.passed[slot]) return 'ignored';
  if (now >= round.deadline) {
    endRound(round, 'timeout', now);
    return 'ignored';
  }
  if (isCorrectGuess(text, round.code)) {
    round.winner = slot;
    endRound(round, 'correct', now);
    return 'correct';
  }
  round.wrong[slot]++;
  return 'wrong';
}

/** Returns true if this pass ended the round (both passed). Mutates `round`. */
export function applyPass(round: RoundState, slot: Slot, now: number): boolean {
  if (round.end) return false;
  round.passed[slot] = true;
  if (round.passed[0] && round.passed[1]) {
    endRound(round, 'passed', now);
    return true;
  }
  return false;
}

/** Ends the round if the deadline has passed. Returns true if it ended now. */
export function applyTimeout(round: RoundState, now: number): boolean {
  if (round.end || now < round.deadline) return false;
  endRound(round, 'timeout', now);
  return true;
}

function endRound(round: RoundState, end: RoundEnd, now: number) {
  round.end = end;
  round.endedAt = now;
}

export interface MatchResult {
  winner: Slot | null;
  scores: [number, number];
  wrongTotals: [number, number];
  decidedBy: 'points' | 'tiebreaker' | 'draw' | 'forfeit';
}

export function scoresOf(rounds: readonly RoundState[]): [number, number] {
  const s: [number, number] = [0, 0];
  for (const r of rounds) if (r.winner !== null) s[r.winner]++;
  return s;
}

export function wrongTotalsOf(rounds: readonly RoundState[]): [number, number] {
  const w: [number, number] = [0, 0];
  for (const r of rounds) {
    w[0] += r.wrong[0];
    w[1] += r.wrong[1];
  }
  return w;
}

/** Most points wins; tie → fewer total wrong guesses; still tied → draw. */
export function decideMatch(rounds: readonly RoundState[], forfeitedBy: Slot | null = null): MatchResult {
  const scores = scoresOf(rounds);
  const wrongTotals = wrongTotalsOf(rounds);
  if (forfeitedBy !== null) {
    return { winner: forfeitedBy === 0 ? 1 : 0, scores, wrongTotals, decidedBy: 'forfeit' };
  }
  if (scores[0] !== scores[1]) {
    return { winner: scores[0] > scores[1] ? 0 : 1, scores, wrongTotals, decidedBy: 'points' };
  }
  if (wrongTotals[0] !== wrongTotals[1]) {
    return { winner: wrongTotals[0] < wrongTotals[1] ? 0 : 1, scores, wrongTotals, decidedBy: 'tiebreaker' };
  }
  return { winner: null, scores, wrongTotals, decidedBy: 'draw' };
}
