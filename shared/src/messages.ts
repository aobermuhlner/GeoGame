// WebSocket protocol between the browser and the Room Durable Object.
import type { GuessOutcome, MatchResult, RoundEnd, Slot } from './game';
import { REGION_IDS, type RegionId } from './regions';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
/** Flag tokens: room code + 16 random hex chars (lets the Worker route to the right room). */
export const FLAG_TOKEN_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}[0-9a-f]{16}$/;
export const MIN_POOL_SIZE = 10;
export const MAX_NAME_LENGTH = 16;

export type Phase = 'lobby' | 'countdown' | 'playing' | 'reveal' | 'finished';

// ---------- Client → Server ----------
export type ClientMessage =
  | { t: 'hello'; name: string; sessionId: string }
  | { t: 'setRegions'; regions: RegionId[] }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'guess'; round: number; text: string }
  | { t: 'pass'; round: number }
  | { t: 'giveUp' }
  | { t: 'rematch' }
  | { t: 'backToLobby' }
  /** Leave the room for good (frees the seat now instead of after the reconnect grace). */
  | { t: 'leave' }
  | { t: 'ping' };

// ---------- Server → Client ----------
export interface PlayerView {
  name: string;
  ready: boolean;
  connected: boolean;
  score: number;
  wrongTotal: number;
  /** Passed on the current round */
  passed: boolean;
  /** Accepted a rematch on the results screen */
  rematch: boolean;
  /** Server time by which a disconnected player must be back (null while connected) */
  graceEndsAt: number | null;
  /** Left for good */
  left: boolean;
}

export type ForfeitReason = 'gaveUp' | 'left' | 'disconnected';

export interface RoundView {
  /** Flag image token, fetch from GET /flags/:token */
  flag: string;
  countryName: string;
  winner: Slot | null;
  wrong: [number, number];
  end: RoundEnd;
}

export interface RoomView {
  code: string;
  phase: Phase;
  /** Index = slot. Slot 0 is the host. */
  players: PlayerView[];
  regions: RegionId[];
  countryCount: number;
  /** 1-based current round (0 before the first round) */
  round: number;
  totalRounds: number;
  /** Token of the current flag; null in lobby/countdown */
  flag: string | null;
  /** Server-clock ms timestamps */
  countdownEndsAt: number | null;
  deadline: number | null;
  revealEndsAt: number | null;
  /** Result of the round just finished (phase 'reveal') */
  reveal: RoundView | null;
  history: RoundView[];
  result: MatchResult | null;
  /** Why the match ended early, if it did */
  forfeitReason: ForfeitReason | null;
}

export type ErrorCode = 'room_full' | 'not_found' | 'bad_message' | 'not_allowed' | 'pool_too_small' | 'in_progress';

export type ServerMessage =
  /** Full room snapshot. `you` is the receiving player's slot (it can change if the host leaves the lobby). */
  | { t: 'state'; room: RoomView; you: Slot; now: number }
  | { t: 'guessResult'; round: number; outcome: GuessOutcome }
  | { t: 'oppWrong'; round: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong' };

// ---------- Validation ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;
const REGION_SET = new Set<string>(REGION_IDS);

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

/** Parse and validate an incoming client message. Returns null for anything malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello': {
      const name = cleanName(m.name);
      if (!name || typeof m.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(m.sessionId)) return null;
      return { t: 'hello', name, sessionId: m.sessionId };
    }
    case 'setRegions': {
      if (!Array.isArray(m.regions) || m.regions.length === 0 || m.regions.length > REGION_IDS.length) return null;
      if (!m.regions.every((r) => typeof r === 'string' && REGION_SET.has(r))) return null;
      return { t: 'setRegions', regions: REGION_IDS.filter((r) => (m.regions as string[]).includes(r)) };
    }
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'guess':
      if (!isInt(m.round) || typeof m.text !== 'string' || m.text.length > 80) return null;
      return { t: 'guess', round: m.round, text: m.text };
    case 'pass':
      return isInt(m.round) ? { t: 'pass', round: m.round } : null;
    case 'start':
    case 'giveUp':
    case 'rematch':
    case 'backToLobby':
    case 'leave':
    case 'ping':
      return { t: m.t };
    default:
      return null;
  }
}
