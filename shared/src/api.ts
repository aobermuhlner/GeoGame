// HTTP API shapes for accounts, the daily challenge and leaderboards (Worker ↔ browser).
import type { DailyView } from './daily';
import type { GuessOutcome } from './game';
import { MODE_IDS, type ModeId } from './modes';

export interface UserView {
  id: string;
  displayName: string;
  email: string | null;
  picture: string | null;
  createdAt: number;
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
  modes: Record<ModeId, { status: DailyStatus; score: number | null; rank: number | null }>;
}

export interface DailyResponse {
  run: DailyView;
  now: number;
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
