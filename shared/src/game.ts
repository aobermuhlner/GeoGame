// Pure game rules shared by the Durable Object (authoritative) and the local mock.
import { COUNTRIES } from './countries';
import { MODES, type ModeId } from './modes';
import type { RegionId } from './regions';

export const ROUNDS_PER_GAME = 10;
export const ROUND_TIME_MS = 20_000;
export const REVEAL_MS = 2_500;
/** Lock-in reveals show both answers, the map or the translation: they stay up longer. */
export const LOCK_REVEAL_MS = 5_000;
export const COUNTDOWN_MS = 3_000;
/** "Name vs Name" intro shown before the first countdown of a match. */
export const MATCH_INTRO_MS = 3_000;
/** Countdown before each minigame after the first ("Next up: Capitals"). */
export const STAGE_INTRO_MS = 4_000;
export const RECONNECT_GRACE_MS = 20_000;

/** Player seat: 0 = host, 1 = guest. */
export type Slot = 0 | 1;

/** 'locked': lock-in modes, every player locked in an answer or passed */
export type RoundEnd = 'correct' | 'passed' | 'timeout' | 'forfeit' | 'locked';

/** A player's final answer in a lock-in round. */
export interface Lock {
  /** Display name of what they answered */
  answer: string;
  at: number;
  correct: boolean;
}

/** Lock-in rounds: a correct answer scores 1 (pins: 1–5 by radius), and the quicker of the correct answers 1 more. */
export const LOCK_POINTS = 1;
export const LOCK_SPEED_BONUS = 1;

export interface RoundState {
  /** Minigame this round belongs to (absent in rounds stored before modes existed → flags) */
  mode?: ModeId;
  /** The round's item (ISO code, landmark id or sentence id, see modes.ts) — never sent to clients before the round ends. */
  code: string;
  startedAt: number;
  deadline: number;
  wrong: [number, number];
  passed: [boolean, boolean];
  winner: Slot | null;
  /** Set once the round is over. */
  end: RoundEnd | null;
  endedAt: number | null;
  /** Lock-in modes: each player's final answer (absent until someone locks in) */
  locks?: [Lock | null, Lock | null];
  /** Lock-in modes: points per player, set when the round ends (other modes: 1 for the winner) */
  points?: [number, number];
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

/** The smallest pool among `modes` for these regions (a game needs MIN_POOL_SIZE items to start). */
export function smallestPool(regions: readonly RegionId[], modes: readonly ModeId[]): { mode: ModeId; size: number } {
  return modes
    .map((mode) => ({ mode, size: MODES[mode].pool(regions).length }))
    .reduce((a, b) => (b.size < a.size ? b : a));
}

/** Rounds per minigame: the same for every mode, or chosen per mode. */
export type StageCount = number | ((mode: ModeId) => number);

/**
 * Items for a multi-game match: `count` per mode from that mode's pool, played in the given order.
 * Each stage avoids items already used by earlier stages while the pool allows it.
 */
export function pickStages(
  regions: readonly RegionId[],
  modes: readonly ModeId[],
  count: StageCount = ROUNDS_PER_GAME,
  rng: () => number = Math.random,
): { codes: string[]; roundModes: ModeId[] } {
  return pickStagesWith((m) => MODES[m].pool(regions), modes, count, rng);
}

/** Like pickStages, from an explicit list of country codes (ranked division pools, country modes only). */
export function pickStagesFrom(
  pool: readonly string[],
  modes: readonly ModeId[],
  count: StageCount = ROUNDS_PER_GAME,
  rng: () => number = Math.random,
): { codes: string[]; roundModes: ModeId[] } {
  return pickStagesWith(() => pool, modes, count, rng);
}

function pickStagesWith(
  poolOf: (mode: ModeId) => readonly string[],
  modes: readonly ModeId[],
  count: StageCount,
  rng: () => number,
): { codes: string[]; roundModes: ModeId[] } {
  const codes: string[] = [];
  const roundModes: ModeId[] = [];
  for (const mode of modes) {
    const pool = poolOf(mode);
    const used = new Set(codes);
    const fresh = pool.filter((c) => !used.has(c));
    const n = typeof count === 'number' ? count : count(mode);
    const src = fresh.length >= Math.min(n, pool.length) ? fresh : pool;
    const picked = shuffleTake(src, n, rng, MODES[mode].groupOf);
    codes.push(...picked);
    roundModes.push(...picked.map(() => mode));
  }
  return { codes, roundModes };
}

/** Fisher–Yates, then `count` items, one per group first while there are enough groups. */
function shuffleTake(
  items: readonly string[],
  count: number,
  rng: () => number,
  groupOf?: (item: string) => string,
): string[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (groupOf) {
    const seen = new Set<string>();
    const firsts: string[] = [];
    const rest: string[] = [];
    for (const x of a) {
      const g = groupOf(x);
      if (seen.has(g)) rest.push(x);
      else {
        seen.add(g);
        firsts.push(x);
      }
    }
    a.splice(0, a.length, ...firsts, ...rest);
  }
  return a.slice(0, Math.min(count, a.length));
}

export interface StageInfo<T extends string = ModeId> {
  /** 0-based index into the match's list of modes */
  stage: number;
  mode: T;
  /** 0-based index of the stage's first round in the flat round list */
  start: number;
  rounds: number;
}

/** Which stage the (0-based) round `index` belongs to. */
export function stageAt<T extends string = ModeId>(roundModes: readonly T[], index: number): StageInfo<T> {
  const i = Math.max(0, Math.min(index, roundModes.length - 1));
  const mode = roundModes[i] ?? ('flags' as T);
  let start = i;
  while (start > 0 && roundModes[start - 1] === mode) start--;
  let end = i;
  while (end + 1 < roundModes.length && roundModes[end + 1] === mode) end++;
  let stage = 0;
  for (let k = 1; k <= start; k++) if (roundModes[k] !== roundModes[k - 1]) stage++;
  return { stage, mode, start, rounds: end - start + 1 };
}

export const revealMsOf = (mode: ModeId): number => (MODES[mode].lockIn ? LOCK_REVEAL_MS : REVEAL_MS);

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

/** 'locked': a lock-in answer was taken (right or wrong is only told at the end); 'invalid': it names no answer */
export type GuessOutcome = 'correct' | 'wrong' | 'ignored' | 'locked' | 'invalid';

/** Every player has locked in or passed. */
const allAnswered = (round: RoundState) => ([0, 1] as const).every((s) => round.passed[s] || !!round.locks?.[s]);

/**
 * Apply a guess in arrival order. The first correct guess to arrive ends the
 * round; anything arriving after that (or from a player who passed) is ignored.
 * Lock-in modes take one answer per player and end the round once both have answered.
 * Mutates `round`.
 */
export function applyGuess(round: RoundState, slot: Slot, text: string, now: number): GuessOutcome {
  if (round.end || round.passed[slot]) return 'ignored';
  if (now >= round.deadline) {
    endRound(round, 'timeout', now);
    return 'ignored';
  }
  const mode = MODES[round.mode ?? 'flags'];
  if (mode.lockIn) {
    if (round.locks?.[slot]) return 'ignored';
    const answer = mode.nameOf(text);
    if (!answer) return 'invalid';
    const correct = mode.isCorrect(text, round.code);
    (round.locks ??= [null, null])[slot] = { answer, at: now, correct };
    if (!correct) round.wrong[slot]++;
    if (allAnswered(round)) endRound(round, 'locked', now);
    return 'locked';
  }
  if (mode.isCorrect(text, round.code)) {
    round.winner = slot;
    endRound(round, 'correct', now);
    return 'correct';
  }
  round.wrong[slot]++;
  // Out of tries (map modes): counts as passing.
  const max = mode.maxWrong;
  if (max !== undefined && round.wrong[slot] >= max) applyPass(round, slot, now);
  return 'wrong';
}

/** Returns true if this pass ended the round (both passed, or the other one locked in). Mutates `round`. */
export function applyPass(round: RoundState, slot: Slot, now: number): boolean {
  if (round.end || round.locks?.[slot]) return false;
  round.passed[slot] = true;
  if (allAnswered(round)) {
    endRound(round, round.locks?.some(Boolean) ? 'locked' : 'passed', now);
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
  if (round.locks) scoreLocks(round);
}

/** Lock-in scoring; the round's winner is whoever scored more in it (null on equal points). */
function scoreLocks(round: RoundState) {
  const locks = round.locks!;
  const worth = MODES[round.mode ?? 'flags'].lockPoints;
  const points: [number, number] = [0, 0];
  let first: Slot | null = null;
  for (const s of [0, 1] as const) {
    const l = locks[s];
    if (!l?.correct) continue;
    points[s] = worth ? worth(l.answer) : LOCK_POINTS;
    if (first === null || l.at < locks[first]!.at) first = s;
  }
  if (first !== null) points[first] += LOCK_SPEED_BONUS;
  round.points = points;
  round.winner = points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1;
}

/** Points each player got in a finished round. */
export function roundPoints(round: Pick<RoundState, 'points' | 'winner'>): [number, number] {
  if (round.points) return [round.points[0], round.points[1]];
  return round.winner === null ? [0, 0] : round.winner === 0 ? [1, 0] : [0, 1];
}

export interface MatchResult {
  winner: Slot | null;
  scores: [number, number];
  wrongTotals: [number, number];
  decidedBy: 'points' | 'tiebreaker' | 'draw' | 'forfeit';
}

export function scoresOf(rounds: readonly RoundState[]): [number, number] {
  const s: [number, number] = [0, 0];
  for (const r of rounds) {
    const [a, b] = roundPoints(r);
    s[0] += a;
    s[1] += b;
  }
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
