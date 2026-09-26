// Single-player daily challenge: every account gets one run per game per (UTC) day.
// Same countries for everyone that day. Pure rules, run by the Accounts Durable Object.
import { COUNTRY_BY_CODE } from './countries';
import { COUNTDOWN_MS, ROUND_TIME_MS, ROUNDS_PER_GAME, type GuessOutcome } from './game';
import { MODES, type ModeId } from './modes';

export const DAILY_ROUNDS = ROUNDS_PER_GAME;
/** Points for a correct answer: base + speed bonus (linear in the time left). */
export const SOLO_BASE_POINTS = 50;
export const SOLO_SPEED_POINTS = 50;
export const SOLO_WRONG_PENALTY = 5;
export const SOLO_MIN_POINTS = 10;
export const SOLO_MAX_SCORE = DAILY_ROUNDS * (SOLO_BASE_POINTS + SOLO_SPEED_POINTS);

export type SoloEnd = 'correct' | 'passed' | 'timeout';

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

function newSoloRound(code: string, token: string, startsAt: number): SoloRound {
  return { code, token, startsAt, deadline: startsAt + ROUND_TIME_MS, wrong: 0, end: null, endedAt: null, points: 0 };
}

/** A fresh run; the first round starts after the usual countdown. */
export function newDailyRun(date: string, mode: ModeId, codes: string[], now: number, token: string): DailyRun {
  return {
    date,
    mode,
    codes,
    rounds: [newSoloRound(codes[0], token, now + COUNTDOWN_MS)],
    startedAt: now,
    finishedAt: null,
    score: 0,
  };
}

const currentOf = (run: DailyRun) => run.rounds[run.rounds.length - 1];

function endSoloRound(run: DailyRun, end: SoloEnd, now: number) {
  const r = currentOf(run);
  r.end = end;
  r.endedAt = now;
  if (end === 'correct') r.points = soloPoints(now - r.startsAt, r.wrong);
  // Map modes: wrong clicks cost points even when the country is never found.
  else if (MODES[run.mode].maxWrong !== undefined) r.points = -SOLO_WRONG_PENALTY * r.wrong;
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
  if (MODES[run.mode].isCorrect(text, r.code)) {
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
  run.rounds.push(newSoloRound(run.codes[run.rounds.length], token, now));
  return true;
}

// ---------- Client view ----------

export interface SoloRoundView {
  flag: string;
  /** ISO code of the answer (safe: only sent once the round is over) */
  code: string;
  countryName: string;
  /** What had to be typed (country or capital) */
  answer: string;
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
  /** Country name for modes that show it (capitals) */
  prompt: string | null;
  /** Server-clock ms */
  startsAt: number;
  deadline: number | null;
  wrong: number;
  /** The round that just ended (phase 'reveal' and 'finished') */
  reveal: SoloRoundView | null;
  history: SoloRoundView[];
  score: number;
  maxScore: number;
}

function roundView(mode: ModeId, r: SoloRound): SoloRoundView {
  return {
    flag: r.token,
    code: r.code,
    countryName: COUNTRY_BY_CODE[r.code].name,
    answer: MODES[mode].answerOf(r.code),
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
    prompt: live && MODES[run.mode].showsCountry ? COUNTRY_BY_CODE[r.code].name : null,
    startsAt: r.startsAt,
    deadline: r.end ? null : r.deadline,
    wrong: r.wrong,
    reveal: r.end ? roundView(run.mode, r) : null,
    history: run.rounds.filter((x) => x.end).map((x) => roundView(run.mode, x)),
    score: run.score,
    maxScore: run.codes.length * (SOLO_BASE_POINTS + SOLO_SPEED_POINTS),
  };
}
