// Single-player daily challenge: every account gets one run per game per (UTC) day.
// Same countries for everyone that day. Pure rules, run by the Accounts Durable Object.
import { COUNTDOWN_MS, ROUND_TIME_MS, ROUNDS_PER_GAME, roundTimeOf, type GuessOutcome } from './game';
import { estimatePoints } from './guess';
import { focusOf } from './landmarkRules';
import { MODES, itemInfo, type ModeId } from './modes';

export const DAILY_ROUNDS = ROUNDS_PER_GAME;
/** Points for a correct answer: base + speed bonus (linear in the time left). */
export const SOLO_BASE_POINTS = 50;
export const SOLO_SPEED_POINTS = 50;
export const SOLO_WRONG_PENALTY = 5;
export const SOLO_MIN_POINTS = 10;
export const SOLO_MAX_SCORE = DAILY_ROUNDS * (SOLO_BASE_POINTS + SOLO_SPEED_POINTS);

/** 'wrong': a lock-in mode's one answer was wrong */
export type SoloEnd = 'correct' | 'passed' | 'timeout' | 'wrong';

export interface SoloRound {
  code: string;
  /** Random flag token, served from GET /daily/flags/:token once the round has started */
  token: string;
  startsAt: number;
  deadline: number;
  wrong: number;
  end: SoloEnd | null;
  endedAt: number | null;
  points: number;
  /** Lock-in modes: the answer given */
  given?: string;
  /** Estimation games: how close the answer was, 0…1 */
  accuracy?: number;
}

export interface DailyRun {
  date: string;
  mode: ModeId;
  codes: string[];
  rounds: SoloRound[];
  startedAt: number;
  finishedAt: number | null;
  score: number;
}

/** UTC calendar day, e.g. "2026-09-26". */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Start of the next UTC day (when the next daily unlocks). */
export function nextDayAt(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function soloPoints(elapsedMs: number, wrong: number): number {
  const left = Math.max(0, Math.min(1, 1 - elapsedMs / ROUND_TIME_MS));
  const pts = SOLO_BASE_POINTS + Math.round(SOLO_SPEED_POINTS * left) - SOLO_WRONG_PENALTY * wrong;
  return Math.max(SOLO_MIN_POINTS, pts);
}

function newSoloRound(code: string, token: string, startsAt: number, mode: ModeId): SoloRound {
  return { code, token, startsAt, deadline: startsAt + roundTimeOf(mode), wrong: 0, end: null, endedAt: null, points: 0 };
}

/** A fresh run; the first round starts after the usual countdown. */
export function newDailyRun(date: string, mode: ModeId, codes: string[], now: number, token: string): DailyRun {
  return {
    date,
    mode,
    codes,
    rounds: [newSoloRound(codes[0], token, now + COUNTDOWN_MS, mode)],
    startedAt: now,
    finishedAt: null,
    score: 0,
  };
}

const currentOf = (run: DailyRun) => run.rounds[run.rounds.length - 1];

/** Total time spent on the run: each ended round from its start to its answer, pass or timeout. */
export function runTimeMs(run: DailyRun): number {
  return run.rounds.reduce((n, r) => n + (r.endedAt !== null ? Math.max(0, r.endedAt - r.startsAt) : 0), 0);
}

function endSoloRound(run: DailyRun, end: SoloEnd, now: number) {
  const r = currentOf(run);
  r.end = end;
  r.endedAt = now;
  const m = MODES[run.mode];
  // Estimation games: points for accuracy, whatever the speed.
  if (r.accuracy !== undefined) r.points = estimatePoints(r.accuracy);
  else if (end === 'correct') {
    r.points = soloPoints(now - r.startsAt, r.wrong);
    // Pins: a bigger circle is worth less.
    if (m.lockPoints && r.given) r.points = Math.round((r.points * m.lockPoints(r.given)) / m.maxLockPoints!);
  }
  // Map modes: wrong clicks cost points even when the country is never found.
  else if (m.maxWrong !== undefined) r.points = -SOLO_WRONG_PENALTY * r.wrong;
  run.score = run.rounds.reduce((n, x) => n + x.points, 0);
  if (run.rounds.length >= run.codes.length) run.finishedAt = now;
}

/** Ends the current round if its time is up. Returns true if anything changed. Mutates `run`. */
export function settleRun(run: DailyRun, now: number): boolean {
  const r = currentOf(run);
  if (r.end || now < r.deadline) return false;
  // Timed out rounds end at their deadline, even if we only notice later.
  endSoloRound(run, 'timeout', r.deadline);
  return true;
}

/** `round` is 1-based and must be the current one. Mutates `run`. */
export function soloGuess(run: DailyRun, round: number, text: string, now: number): GuessOutcome {
  settleRun(run, now);
  const r = currentOf(run);
  if (round !== run.rounds.length || r.end || now < r.startsAt) return 'ignored';
  const mode = MODES[run.mode];
  if (mode.lockIn) {
    // One answer, and it ends the round (a typo that names nothing is refused).
    const given = mode.nameOf(text);
    if (!given) return 'invalid';
    r.given = given;
    const accuracy = mode.accuracy?.(text, r.code);
    if (accuracy !== undefined) r.accuracy = accuracy;
    const correct = mode.isCorrect(text, r.code);
    endSoloRound(run, correct ? 'correct' : 'wrong', now);
    return correct ? 'correct' : 'wrong';
  }
  if (mode.isCorrect(text, r.code)) {
    endSoloRound(run, 'correct', now);
    return 'correct';
  }
  r.wrong++;
  // Out of tries (map modes): the round is over, no points.
  const max = MODES[run.mode].maxWrong;
  if (max !== undefined && r.wrong >= max) endSoloRound(run, 'passed', now);
  return 'wrong';
}

/** Returns true if the round was skipped. Mutates `run`. */
export function soloPass(run: DailyRun, round: number, now: number): boolean {
  settleRun(run, now);
  const r = currentOf(run);
  if (round !== run.rounds.length || r.end || now < r.startsAt) return false;
  endSoloRound(run, 'passed', now);
  return true;
}

/**
 * After round `round` (1-based) ended, start the next one right away.
 * Idempotent: a repeated call for the same round does nothing. Mutates `run`.
 */
export function soloNext(run: DailyRun, round: number, now: number, token: string): boolean {
  settleRun(run, now);
  const r = currentOf(run);
  if (round !== run.rounds.length || !r.end || run.rounds.length >= run.codes.length) return false;
  run.rounds.push(newSoloRound(run.codes[run.rounds.length], token, now, run.mode));
  return true;
}

// ---------- Client view ----------

export interface SoloRoundView {
  flag: string;
  /** The round's item (safe: only sent once the round is over) */
  code: string;
  /** ISO code of the country it is about (null for languages) */
  country: string | null;
  countryName: string;
  /** What had to be typed (country, capital or language) */
  answer: string;
  /** Landmark name or the sentence's translation */
  detail: string | null;
  /** Lock-in modes: what the player answered */
  given: string | null;
  /** Estimation games: how close the answer was, 0…1 (null otherwise, or without an answer) */
  accuracy: number | null;
  end: SoloEnd;
  wrong: number;
  points: number;
  /** Time to answer (correct rounds) */
  timeMs: number | null;
}

export interface DailyView {
  date: string;
  mode: ModeId;
  phase: 'countdown' | 'playing' | 'reveal' | 'finished';
  /** 1-based current round */
  round: number;
  totalRounds: number;
  /** Current flag token (null during the countdown and once the round is over) */
  flag: string | null;
  /** Text shown with the prompt (capitals: the country; languages: the sentence) */
  prompt: string | null;
  /** Landmark photo rounds: where the zoom starts (null otherwise) */
  focus: [number, number] | null;
  /** Server-clock ms */
  startsAt: number;
  deadline: number | null;
  wrong: number;
  /** The round that just ended (phase 'reveal' and 'finished') */
  reveal: SoloRoundView | null;
  history: SoloRoundView[];
  score: number;
  maxScore: number;
  /** Total time spent on the ended rounds (the leaderboard tiebreaker) */
  timeMs: number;
}

function roundView(mode: ModeId, r: SoloRound): SoloRoundView {
  return {
    flag: r.token,
    code: r.code,
    ...itemInfo(mode, r.code),
    given: r.given ?? null,
    accuracy: r.accuracy ?? null,
    end: r.end!,
    wrong: r.wrong,
    points: r.points,
    timeMs: r.end === 'correct' && r.endedAt !== null ? r.endedAt - r.startsAt : null,
  };
}

export function dailyView(run: DailyRun, now: number): DailyView {
  const r = currentOf(run);
  const phase: DailyView['phase'] =
    run.finishedAt !== null ? 'finished' : r.end ? 'reveal' : now < r.startsAt ? 'countdown' : 'playing';
  const live = phase === 'playing';
  return {
    date: run.date,
    mode: run.mode,
    phase,
    round: run.rounds.length,
    totalRounds: run.codes.length,
    flag: live ? r.token : null,
    prompt: live ? (MODES[run.mode].promptText?.(r.code) ?? null) : null,
    focus: live && MODES[run.mode].prompt === 'photo' ? focusOf(r.code) : null,
    startsAt: r.startsAt,
    deadline: r.end ? null : r.deadline,
    wrong: r.wrong,
    reveal: r.end ? roundView(run.mode, r) : null,
    history: run.rounds.filter((x) => x.end).map((x) => roundView(run.mode, x)),
    score: run.score,
    maxScore: run.codes.length * (SOLO_BASE_POINTS + SOLO_SPEED_POINTS),
    timeMs: runTimeMs(run),
  };
}
