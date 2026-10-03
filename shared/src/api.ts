// HTTP API shapes for accounts, the daily challenge and leaderboards (Worker ↔ browser).
import type { ChallengeBests } from './challenges';
import type { DailyView } from './daily';
import type { GuessOutcome } from './game';
import type { HigherRunView, PickOutcome, StatId } from './higher';
import type { PlacementResult } from './placement';
import { MODE_IDS, type ModeId } from './modes';

export interface UserView {
  id: string;
  displayName: string;
  email: string | null;
  picture: string | null;
  createdAt: number;
  /** Name-only guest account: tied to this browser, lost on sign-out */
  guest: boolean;
}

export interface ModeStats {
  played: number;
  best: number | null;
  average: number | null;
}

export interface UserStats {
  /** Days with at least one finished daily game */
  daysPlayed: number;
  /** Consecutive days up to today (or yesterday, if today isn't played yet) */
  streak: number;
  daily: Record<ModeId, ModeStats>;
  /** Daily Higher or Lower */
  higher: { played: number; bestFlawless: number | null; perfect: number };
}

export interface MeResponse {
  user: UserView;
  stats: UserStats;
}

export interface AuthConfig {
  /** Google OAuth client id; null if Google sign-in isn't configured on this Worker */
  googleClientId: string | null;
  /** Local development: name-only sign-in without Google */
  devLogin: boolean;
  /** Name-only guest sign-in (until proper logins are required) */
  guestLogin: boolean;
}

export interface LoginResponse {
  token: string;
  user: UserView;
}

export type DailyStatus = 'new' | 'playing' | 'finished';

export interface DailySummary {
  date: string;
  /** Server-clock ms when the next daily unlocks */
  nextAt: number;
  modes: Record<
    ModeId,
    {
      status: DailyStatus;
      score: number | null;
      timeMs: number | null;
      rank: number | null;
      /** Finished runs of this game today (with `rank`: "top 12 %") */
      players: number;
    }
  >;
  higher: HigherSummary;
}

/** Today's Higher or Lower for one player. Scores are null until the run is finished. */
export interface HigherSummary {
  status: DailyStatus;
  /** Today's category */
  stat: StatId;
  rounds: number;
  flawless: number | null;
  correct: number | null;
  timeMs: number | null;
  rank: number | null;
}

export interface HigherResponse {
  run: HigherRunView;
  now: number;
}

export interface HigherPickResponse extends HigherResponse {
  outcome: PickOutcome;
}

export interface HigherBoardEntry {
  rank: number;
  name: string;
  /** Correct answers in a row from the first question (ranks first) */
  flawless: number;
  /** All correct answers (tiebreaker) */
  correct: number;
  /** Answer time (second tiebreaker) */
  timeMs: number;
  you: boolean;
}

export interface HigherBoardResponse {
  date: string;
  stat: StatId;
  rounds: number;
  entries: HigherBoardEntry[];
  you: HigherBoardEntry | null;
  players: number;
}

export interface DailyResponse {
  run: DailyView;
  now: number;
  /** Ranked placement test: the result once the test is finished */
  placement?: PlacementResult | null;
}

export interface DailyGuessResponse extends DailyResponse {
  outcome: GuessOutcome;
}

export type BoardId = ModeId | 'overall';
export const BOARD_IDS: readonly BoardId[] = [...MODE_IDS, 'overall'];

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  /** Total time of the run(s); equal scores are ranked by it */
  timeMs: number;
  you: boolean;
}

export interface LeaderboardResponse {
  date: string;
  board: BoardId;
  entries: LeaderboardEntry[];
  /** Your own placing, also when you're outside the top list */
  you: LeaderboardEntry | null;
  players: number;
}

export const LEADERBOARD_SIZE = 50;

/**
 * "Top X %" for rank `rank` of `players` (1-based; rank 1 of 200 → 1, rank 50 of 200 → 25). Null when there is
 * nobody to compare with.
 */
export function topPercent(rank: number | null, players: number): number | null {
  if (rank === null || players < 2) return null;
  return Math.max(1, Math.ceil((rank / players) * 100));
}

/** GET /challenges: your best full-completion time per challenge id. */
export interface ChallengesResponse {
  bests: ChallengeBests;
}

/** POST /challenges/:id/result { codes, timeMs } */
export interface ChallengeResultResponse extends ChallengesResponse {
  /** This run beat your previous best (or was the first completion) */
  improved: boolean;
}
