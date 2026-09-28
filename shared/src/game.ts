// Pure game rules shared by the Durable Object (authoritative) and the local mock.
import { COUNTRIES } from './countries';
import { MODES, type ModeId } from './modes';
import type { RegionId } from './regions';

export const ROUNDS_PER_GAME = 10;
export const ROUND_TIME_MS = 20_000;
export const REVEAL_MS = 2_500;
export const COUNTDOWN_MS = 3_000;
/** "Name vs Name" intro shown before the first countdown of a match. */
export const MATCH_INTRO_MS = 3_000;
/** Countdown before each minigame after the first ("Next up: Capitals"). */
export const STAGE_INTRO_MS = 4_000;
export const RECONNECT_GRACE_MS = 20_000;

/** Player seat: 0 = host, 1 = guest. */
export type Slot = 0 | 1;

export type RoundEnd = 'correct' | 'passed' | 'timeout' | 'forfeit';

export interface RoundState {
  /** Minigame this round belongs to (absent in rounds stored before modes existed → flags) */
  mode?: ModeId;
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
  return shuffleTake(countriesInRegions(regions), count, rng);
}

/** Rounds per minigame: the same for every mode, or chosen per mode. */
export type StageCount = number | ((mode: ModeId) => number);

/**
 * Countries for a multi-game match: `count` per mode, played in the given order.
 * Each stage avoids countries already used by earlier stages while the pool allows it.
 */
export function pickStages(
  regions: readonly RegionId[],
  modes: readonly ModeId[],
  count: StageCount = ROUNDS_PER_GAME,
  rng: () => number = Math.random,
): { codes: string[]; roundModes: ModeId[] } {
  return pickStagesFrom(countriesInRegions(regions), modes, count, rng);
}

/** Like pickStages, from an explicit list of country codes (ranked division pools). */
export function pickStagesFrom(
  pool: readonly string[],
  modes: readonly ModeId[],
  count: StageCount = ROUNDS_PER_GAME,
  rng: () => number = Math.random,
): { codes: string[]; roundModes: ModeId[] } {
  const codes: string[] = [];
  const roundModes: ModeId[] = [];
  for (const mode of modes) {
    const used = new Set(codes);
    const fresh = pool.filter((c) => !used.has(c));
    const n = typeof count === 'number' ? count : count(mode);
    const src = fresh.length >= Math.min(n, pool.length) ? fresh : pool;
    const picked = shuffleTake(src, n, rng);
    codes.push(...picked);
    roundModes.push(...picked.map(() => mode));
  }
  return { codes, roundModes };
}

function shuffleTake(items: readonly string[], count: number, rng: () => number): string[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(count, a.length));
}

export interface StageInfo {
  /** 0-based index into the match's list of modes */
  stage: number;
  mode: ModeId;
  /** 0-based index of the stage's first round in the flat round list */
  start: number;
  rounds: number;
}

/** Which stage the (0-based) round `index` belongs to. */
export function stageAt(roundModes: readonly ModeId[], index: number): StageInfo {
  const i = Math.max(0, Math.min(index, roundModes.length - 1));
  const mode = roundModes[i] ?? 'flags';
  let start = i;
  while (start > 0 && roundModes[start - 1] === mode) start--;
  let end = i;
  while (end + 1 < roundModes.length && roundModes[end + 1] === mode) end++;
  let stage = 0;
  for (let k = 1; k <= start; k++) if (roundModes[k] !== roundModes[k - 1]) stage++;
  return { stage, mode, start, rounds: end - start + 1 };
}

export function newRound(code: string, now: number, mode: ModeId = 'flags'): RoundState {
  return {
    mode,
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
  if (MODES[round.mode ?? 'flags'].isCorrect(text, round.code)) {
    round.winner = slot;
    endRound(round, 'correct', now);
    return 'correct';
  }
  round.wrong[slot]++;
  // Out of tries (map modes): counts as passing.
  const max = MODES[round.mode ?? 'flags'].maxWrong;
  if (max !== undefined && round.wrong[slot] >= max) applyPass(round, slot, now);
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

/** Over all minigames: most points wins; tie → fewer total wrong guesses; still tied → draw. */
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
