// HTTP API shapes for accounts, the daily challenge and leaderboards (Worker ↔ browser).
import type { DailyView } from './daily';
import type { GuessOutcome } from './game';
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
  modes: Record<ModeId, { status: DailyStatus; score: number | null; timeMs: number | null; rank: number | null }>;
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
