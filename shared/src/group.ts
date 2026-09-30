// Group game: 2–8 players, every player answers every round. Points for being right and for being quick.
// Pure rules shared by the GroupRoom Durable Object (authoritative) and the browser.
import { ROUND_TIME_MS, type GuessOutcome } from './game';
import {
  DUEL_TIME_MS,
  higherOf,
  newDuelRound,
  nextDuelPair,
  type DuelRound,
  type HigherPair,
  type PairView,
  type RevealedPair,
} from './higher';
import { GUESS_REVEAL_MS, estimatePoints } from './guess';
import { GAME_IDS, type ErrorCode, type GameId, type RoundCounts } from './messages';
import { MODES } from './modes';
import type { RegionId } from './regions';

export const GROUP_MAX_PLAYERS = 8;
export const GROUP_MIN_PLAYERS = 2;
/** A group lobby starts with every game selected, this many rounds each. */
export const GROUP_DEFAULT_ROUNDS = 5;
export const GROUP_DEFAULT_ROUND_COUNTS = Object.fromEntries(
  GAME_IDS.map((g) => [g, GROUP_DEFAULT_ROUNDS]),
) as RoundCounts;

/** Points for a right answer: base + speed bonus (linear in the time left), minus a bit per wrong try. */
export const GROUP_BASE_POINTS = 50;
export const GROUP_SPEED_POINTS = 50;
export const GROUP_WRONG_PENALTY = 5;
export const GROUP_MIN_POINTS = 10;

/** Reveal after each round: everyone's result is listed, so it stays up a little longer than a duel's. */
export const GROUP_REVEAL_MS = 4_000;
/** Lock-in and Higher or Lower reveals also show what everyone answered. */
export const GROUP_LOCK_REVEAL_MS = 5_500;
/** The standings between games: how the overall ranking changed. */
export const GROUP_STANDINGS_MS = 9_000;
/** "Next up: Capitals" before each game. */
export const GROUP_STAGE_INTRO_MS = 4_000;

export const groupTimeOf = (game: GameId): number => (game === 'higher' ? DUEL_TIME_MS : (MODES[game].timeMs ?? ROUND_TIME_MS));
export const groupRevealMsOf = (game: GameId): number =>
  game === 'higher'
    ? GROUP_LOCK_REVEAL_MS
    : MODES[game].accuracy
      ? GUESS_REVEAL_MS + 1_500
      : MODES[game].lockIn
        ? GROUP_LOCK_REVEAL_MS
        : GROUP_REVEAL_MS;

export function groupPoints(elapsedMs: number, totalMs: number, wrong: number): number {
  const left = Math.max(0, Math.min(1, 1 - elapsedMs / totalMs));
  const pts = GROUP_BASE_POINTS + Math.round(GROUP_SPEED_POINTS * left) - GROUP_WRONG_PENALTY * wrong;
  return Math.max(GROUP_MIN_POINTS, pts);
}

/** 'wrong': a lock-in answer or pick was wrong, or a map player ran out of tries */
export type EntryEnd = 'correct' | 'wrong' | 'passed';

/** One player's part of a round. */
export interface Entry {
  wrong: number;
  /** null: still playing (or out of time once the round is over) */
  end: EntryEnd | null;
  /** When they finished */
  at: number | null;
  /** Lock-in games: the answer's display name; Higher or Lower: the ISO code picked; GeoGuesser: the number */
  answer: string | null;
  points: number;
  /** Estimation games: how close the answer was, 0…1 */
  accuracy?: number;
}

export interface GroupRound {
  game: GameId;
  /** Minigames: the round's item (ISO code, landmark id or sentence id); '' for Higher or Lower */
  code: string;
  /** Higher or Lower: the pair */
  pair: HigherPair | null;
  startedAt: number;
  deadline: number;
  /** Index = player */
  entries: Entry[];
  ended: boolean;
  endedAt: number | null;
}

const newEntry = (): Entry => ({ wrong: 0, end: null, at: null, answer: null, points: 0 });

export function newGroupRound(game: GameId, code: string, pair: HigherPair | null, players: number, now: number): GroupRound {
  return {
    game,
    code,
    pair,
    startedAt: now,
    deadline: now + groupTimeOf(game),
    entries: Array.from({ length: players }, newEntry),
    ended: false,
    endedAt: null,
  };
}

function finishEntry(r: GroupRound, e: Entry, end: EntryEnd, now: number) {
  e.end = end;
  e.at = now;
  // Estimation games: points for accuracy only (no speed bonus: the extra time is there to think).
  if (e.accuracy !== undefined) e.points = estimatePoints(e.accuracy);
  else e.points = end === 'correct' ? groupPoints(now - r.startedAt, r.deadline - r.startedAt, e.wrong) : 0;
}

const open = (r: GroupRound, i: number, now: number) => !r.ended && now < r.deadline && !!r.entries[i] && !r.entries[i].end;

/**
 * A typed or clicked answer from player `i`. Flag games: guess until right (each wrong try costs a little);
 * lock-in games: one answer, final. Mutates `r`.
 */
export function groupGuess(r: GroupRound, i: number, text: string, now: number): GuessOutcome {
  if (r.game === 'higher' || !open(r, i, now)) return 'ignored';
  const mode = MODES[r.game];
  const e = r.entries[i];
  if (mode.lockIn) {
    const answer = mode.nameOf(text);
    if (!answer) return 'invalid';
    e.answer = answer;
    const accuracy = mode.accuracy?.(text, r.code);
    if (accuracy !== undefined) e.accuracy = accuracy;
    const correct = mode.isCorrect(text, r.code);
    finishEntry(r, e, correct ? 'correct' : 'wrong', now);
    return 'locked';
  }
  if (mode.isCorrect(text, r.code)) {
    finishEntry(r, e, 'correct', now);
    return 'correct';
  }
  e.wrong++;
  if (mode.maxWrong !== undefined && e.wrong >= mode.maxWrong) finishEntry(r, e, 'wrong', now);
  return 'wrong';
}

/** Higher or Lower: lock in the country you think is higher. Returns true if accepted. Mutates `r`. */
export function groupPick(r: GroupRound, i: number, code: string, now: number): boolean {
  if (r.game !== 'higher' || !r.pair || !open(r, i, now)) return false;
  if (code !== r.pair.a && code !== r.pair.b) return false;
  const e = r.entries[i];
  e.answer = code;
  finishEntry(r, e, code === higherOf(r.pair) ? 'correct' : 'wrong', now);
  return true;
}

/** Returns true if accepted. Mutates `r`. */
export function groupPass(r: GroupRound, i: number, now: number): boolean {
  if (!open(r, i, now)) return false;
  finishEntry(r, r.entries[i], 'passed', now);
  return true;
}

/**
 * Ends the round when everyone still `active` (connected, not gone) has finished, or its time is up.
 * Returns true if it ended now. Mutates `r`.
 */
export function settleGroupRound(r: GroupRound, active: readonly boolean[], now: number): boolean {
  if (r.ended) return false;
  const allDone = r.entries.every((e, i) => e.end !== null || !active[i]);
  if (!allDone && now < r.deadline) return false;
  r.ended = true;
  r.endedAt = Math.min(now, r.deadline);
  return true;
}

/** Higher or Lower pairs for `n` rounds: categories rotate, countries and pairs repeat as little as possible. */
export function pickGroupPairs(pool: readonly string[], n: number, rng: () => number = Math.random): HigherPair[] {
  const rounds: DuelRound[] = [];
  for (let k = 0; k < n; k++) rounds.push(newDuelRound(nextDuelPair(pool, rounds, rng), 0));
  return rounds.map((r) => r.pair);
}

// ---------- Ranking ----------

export interface Tally {
  score: number;
  correct: number;
  /** Time spent on right answers (tiebreaker: quicker is better) */
  timeMs: number;
}

export function tallyOf(rounds: readonly GroupRound[], players: number): Tally[] {
  const t = Array.from({ length: players }, (): Tally => ({ score: 0, correct: 0, timeMs: 0 }));
  for (const r of rounds) {
    if (!r.ended) continue;
    r.entries.forEach((e, i) => {
      if (!t[i]) return;
      t[i].score += e.points;
      if (e.end === 'correct') {
        t[i].correct++;
        t[i].timeMs += (e.at ?? r.startedAt) - r.startedAt;
      }
    });
  }
  return t;
}

/** Most points first; tie → more right answers; still tied → less time on them. */
export function compareTally(a: Tally, b: Tally): number {
  return b.score - a.score || b.correct - a.correct || a.timeMs - b.timeMs;
}

/** 1-based rank of each player (index = player); exact ties share a rank ("1, 1, 3"). */
export function ranksOf(tallies: readonly Tally[]): number[] {
  const order = tallies.map((_, i) => i).sort((a, b) => compareTally(tallies[a], tallies[b]) || a - b);
  const ranks: number[] = new Array(tallies.length).fill(0);
  order.forEach((p, k) => {
    const prev = order[k - 1];
    ranks[p] = k > 0 && compareTally(tallies[prev], tallies[p]) === 0 ? ranks[prev] : k + 1;
  });
  return ranks;
}

// ---------- Protocol ----------

export type GroupPhase = 'lobby' | 'countdown' | 'playing' | 'reveal' | 'standings' | 'finished';

/** What a player's round looks like to everyone else while it runs (answers stay hidden until the reveal). */
export type EntryStatus = 'thinking' | 'correct' | 'locked' | 'passed' | 'out';

export interface GroupPlayerView {
  name: string;
  connected: boolean;
  /** Left for good (stays in the ranking) */
  left: boolean;
  score: number;
  correct: number;
  timeMs: number;
  /** This round (null outside a round) */
  status: EntryStatus | null;
}

export interface GroupEntryView {
  end: EntryEnd | null;
  /** Lock-in answer or Higher or Lower pick (ISO code) */
  answer: string | null;
  /** Estimation games: how close the answer was, 0…1 */
  accuracy: number | null;
  wrong: number;
  points: number;
  /** Time to a right answer */
  timeMs: number | null;
}

export interface GroupRevealView {
  game: GameId;
  /** Minigames: flag/photo token and the item */
  flag: string | null;
  code: string;
  country: string | null;
  countryName: string;
  answer: string;
  detail: string | null;
  /** Higher or Lower */
  pair: RevealedPair | null;
  /** Index = player */
  entries: GroupEntryView[];
}

export interface StandingView {
  player: number;
  rank: number;
  /** Rank before the game that just ended (null after the first game) */
  prevRank: number | null;
  score: number;
  /** Points in the game that just ended */
  gained: number;
}

export interface GroupView {
  code: string;
  phase: GroupPhase;
  /** Index = seat; seat 0 is the host */
  players: GroupPlayerView[];
  maxPlayers: number;
  regions: RegionId[];
  countryCount: number;
  /** Selected games (lobby) or the games of the running match, in play order */
  modes: GameId[];
  roundCounts: RoundCounts;
  /** 0-based index into `modes` of the game being played, about to start, or just finished (standings) */
  stage: number;
  /** 1-based round within the game (0 during its countdown) */
  stageRound: number;
  stageRounds: number;
  /** 1-based round over the match */
  round: number;
  totalRounds: number;
  /** Flag or photo token of the running round */
  flag: string | null;
  /** Capitals/GeoLocate: the country; Languages: the sentence */
  prompt: string | null;
  focus: [number, number] | null;
  /** Higher or Lower pair (values hidden) */
  pair: PairView | null;
  /** Your own entry this round (your lock-in answer or pick) */
  mine: GroupEntryView | null;
  /** Server-clock ms */
  countdownEndsAt: number | null;
  deadline: number | null;
  revealEndsAt: number | null;
  standingsEndsAt: number | null;
  reveal: GroupRevealView | null;
  /** Standings after the last finished game (standings and finished phases), best first */
  standings: StandingView[] | null;
  /** Points per player per finished game (index = player, then game) */
  stageScores: number[][];
}

export type GroupServerMessage =
  | { t: 'state'; room: GroupView; you: number; now: number }
  | { t: 'guessResult'; round: number; outcome: GuessOutcome }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong' };

