// WebSocket protocol between the browser and the Room Durable Object.
import { ROUNDS_PER_GAME, type GuessOutcome, type MatchResult, type RoundEnd, type Slot } from './game';
import { DUEL_ROUNDS, type DuelView } from './higher';
import { MODE_IDS, MODES, type ModeId } from './modes';
import type { RankedView } from './ranked';
import { REGION_IDS, type RegionId } from './regions';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  // 32-char alphabet → no modulo bias
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}
/** Flag tokens: room code + 16 random hex chars (lets the Worker route to the right room). */
export const FLAG_TOKEN_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}[0-9a-f]{16}$/;
export const MIN_POOL_SIZE = 10;
export const MAX_NAME_LENGTH = 16;

/** Every game a friend lobby can play: the minigames plus the Higher or Lower duel, in play order. */
export const GAME_IDS = [...MODE_IDS, 'higher'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const isModeId = (g: GameId): g is ModeId => g !== 'higher';

export const HIGHER_GAME = {
  label: 'Higher or Lower',
  description: 'Two countries, one category — pick the higher one. Only being right counts.',
};
export const gameLabel = (g: GameId): string => (isModeId(g) ? MODES[g].label : HIGHER_GAME.label);

/** The games in a random play order (the lobby's "Random order" option). */
export function shuffleGames(games: readonly GameId[], rng: () => number = Math.random): GameId[] {
  const out = [...games];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Rounds each game lasts in a friend lobby (host's choice; ranked always uses the defaults). */
export type RoundCounts = Record<GameId, number>;
export const MIN_GAME_ROUNDS = 1;
export const MAX_GAME_ROUNDS = 20;
export const DEFAULT_ROUND_COUNTS = Object.fromEntries(
  GAME_IDS.map((g) => [g, g === 'higher' ? DUEL_ROUNDS : ROUNDS_PER_GAME]),
) as RoundCounts;

export type Phase = 'lobby' | 'countdown' | 'playing' | 'reveal' | 'finished';

// ---------- Client → Server ----------
export type ClientMessage =
  | { t: 'hello'; name: string; sessionId: string }
  | { t: 'setRegions'; regions: RegionId[] }
  /** Games to play, in GAME_IDS order (host only, lobby only) */
  | { t: 'setModes'; modes: GameId[] }
  /** How many rounds a game lasts (host only, lobby only) */
  | { t: 'setRounds'; game: GameId; rounds: number }
  /** Play the games in a random order, drawn anew for every match (host only, lobby only) */
  | { t: 'setShuffle'; shuffle: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'guess'; round: number; text: string }
  /** Auto-lock games: the answer set up so far (a placed pin), locked in for you if the time runs out */
  | { t: 'draft'; round: number; text: string }
  | { t: 'pass'; round: number }
  /** Higher or Lower: lock in the country you think is higher (ISO code) */
  | { t: 'pick'; round: number; code: string }
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
  /** Lock-in modes: has locked in an answer this round (what it is stays hidden until the reveal) */
  locked: boolean;
  /** Accepted a rematch on the results screen */
  rematch: boolean;
  /** Server time by which a disconnected player must be back (null while connected) */
  graceEndsAt: number | null;
  /** Left for good */
  left: boolean;
}

export type ForfeitReason = 'gaveUp' | 'left' | 'disconnected';

export interface RoundView {
  mode: ModeId;
  /** Flag (or photo) token, fetch from GET /flags/:token */
  flag: string;
  /** The round's item: ISO code, landmark id or sentence id (only sent once the round is over) */
  code: string;
  /** ISO code of the country it is about (null for languages) */
  country: string | null;
  /** Its name ('' for languages) */
  countryName: string;
  /** What had to be typed: the country, capital or language */
  answer: string;
  /** Landmark name or the sentence's translation */
  detail: string | null;
  winner: Slot | null;
  wrong: [number, number];
  /** Points each player got for the round */
  points: [number, number];
  /** Lock-in modes: what each player locked in (null: passed or out of time) */
  locks: [LockView | null, LockView | null] | null;
  end: RoundEnd;
}

export interface LockView {
  answer: string;
  correct: boolean;
  /** Estimation games: how close it was, 0…1 (null otherwise) */
  accuracy: number | null;
}

export interface RoomView {
  code: string;
  phase: Phase;
  /** Index = slot. Slot 0 is the host. */
  players: PlayerView[];
  regions: RegionId[];
  countryCount: number;
  /** Selected games (lobby) or the games of the running match, in play order */
  modes: GameId[];
  /** 0-based index into `modes` of the minigame being played or about to start */
  stage: number;
  /** 1-based round within the current minigame (0 during its countdown) */
  stageRound: number;
  /** Rounds in the current minigame */
  stageRounds: number;
  /** Text shown with the prompt: the country (capitals, GeoLocate) or the sentence (languages); null otherwise */
  prompt: string | null;
  /** Landmark photo rounds: where the zoom starts, as fractions of the photo (null otherwise) */
  focus: [number, number] | null;
  /** Your own locked-in answer this round (lock-in modes; each player only gets theirs) */
  myLock: string | null;
  /** Map modes: the countries each player clicked wrongly this round (playing and reveal; null otherwise) */
  misses: [string[], string[]] | null;
  /** 1-based current round over the whole match (0 before the first round) */
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
  /** Ranked match info; null in friend lobbies */
  ranked: RankedView | null;
  /** Rounds per game chosen in the lobby */
  roundCounts: RoundCounts;
  /** Games are played in a random order (the games still to come stay hidden) */
  shuffle: boolean;
  /** Higher or Lower state (matches with Higher or Lower rounds, once the match has started) */
  higher: DuelView | null;
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
const GAME_SET = new Set<string>(GAME_IDS);

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
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
    case 'setModes': {
      if (!Array.isArray(m.modes) || m.modes.length === 0 || m.modes.length > GAME_IDS.length) return null;
      if (!m.modes.every((x) => typeof x === 'string' && GAME_SET.has(x))) return null;
      return { t: 'setModes', modes: GAME_IDS.filter((x) => (m.modes as string[]).includes(x)) };
    }
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'setShuffle':
      return typeof m.shuffle === 'boolean' ? { t: 'setShuffle', shuffle: m.shuffle } : null;
    case 'guess':
    case 'draft':
      if (!isInt(m.round) || typeof m.text !== 'string' || m.text.length > 80) return null;
      return { t: m.t, round: m.round, text: m.text };
    case 'pass':
      return isInt(m.round) ? { t: 'pass', round: m.round } : null;
    case 'setRounds':
      if (!GAME_SET.has(m.game as string) || !Number.isInteger(m.rounds)) return null;
      if ((m.rounds as number) < MIN_GAME_ROUNDS || (m.rounds as number) > MAX_GAME_ROUNDS) return null;
      return { t: 'setRounds', game: m.game as GameId, rounds: m.rounds as number };
    case 'pick':
      if (!isInt(m.round) || typeof m.code !== 'string' || !/^[A-Z]{2}$/.test(m.code)) return null;
      return { t: 'pick', round: m.round, code: m.code };
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
