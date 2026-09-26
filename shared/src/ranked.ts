// Ranked 1 vs 1: divisions, their region pools, the Glicko-2 rating and the matchmaking protocol.
// Each minigame has its own rating. Everyone starts at START_RATING with a high rating deviation
// (uncertainty), so the first games move the rating a lot; the swings shrink as the deviation drops.
import { MODE_IDS, type ModeId } from './modes';
import type { RegionId } from './regions';

export const DIVISION_IDS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
export type DivisionId = (typeof DIVISION_IDS)[number];

export interface Division {
  label: string;
  /** Lowest rating in this division */
  min: number;
  /** Regions played in this division (each division adds to the one below) */
  regions: readonly RegionId[];
}

const BRONZE: RegionId[] = ['europe'];
const SILVER: RegionId[] = [...BRONZE, 'south-america', 'north-america'];
const GOLD: RegionId[] = [...SILVER, 'central-america', 'asia'];
const PLATINUM: RegionId[] = [...GOLD, 'africa'];
const DIAMOND: RegionId[] = [...PLATINUM, 'caribbean', 'oceania'];

export const DIVISIONS: Record<DivisionId, Division> = {
  bronze: { label: 'Bronze', min: -Infinity, regions: BRONZE },
  silver: { label: 'Silver', min: 1200, regions: SILVER },
  gold: { label: 'Gold', min: 1400, regions: GOLD },
  platinum: { label: 'Platinum', min: 1600, regions: PLATINUM },
  diamond: { label: 'Diamond', min: 1800, regions: DIAMOND },
};

export function divisionOf(rating: number): DivisionId {
  const r = Math.round(rating);
  let out: DivisionId = 'bronze';
  for (const d of DIVISION_IDS) if (r >= DIVISIONS[d].min) out = d;
  return out;
}

/** Two players from different divisions play the lower division's regions. */
export function matchDivision(a: number, b: number): DivisionId {
  return divisionOf(Math.min(a, b));
}

// ---------- Glicko-2 ----------

export const START_RATING = 1000;
/** Rating deviation of a new player: early games swing by roughly ±80. */
export const START_RD = 200;
/** Floor for the deviation, so an established rating still moves (about ±15 per game). */
export const MIN_RD = 60;
/** Above this deviation the rating is shown as provisional. */
export const PROVISIONAL_RD = 110;
export const START_VOLATILITY = 0.06;
/** System constant: how much the volatility may change (Glickman suggests 0.3–1.2). */
const TAU = 0.5;
const SCALE = 173.7178;

export interface Rating {
  rating: number;
  rd: number;
  vol: number;
}

export const newRating = (): Rating => ({ rating: START_RATING, rd: START_RD, vol: START_VOLATILITY });

/** Deviation grows back while a player is inactive (one Glicko rating period per day), up to START_RD. */
export function inflateRd(r: Rating, idleMs: number): Rating {
  const days = Math.max(0, Math.floor(idleMs / 86_400_000));
  if (!days) return r;
  const phi = r.rd / SCALE;
  return { ...r, rd: Math.min(START_RD, Math.sqrt(phi * phi + days * r.vol * r.vol) * SCALE) };
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/**
 * New rating of `me` after one game against `opp`. `score`: 1 win, 0.5 draw, 0 loss.
 * Losing to a stronger player costs little, losing to a weaker one costs a lot (and vice versa for wins).
 */
export function glicko2(me: Rating, opp: Rating, score: number): Rating {
  const mu = (me.rating - START_RATING) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (opp.rating - START_RATING) / SCALE;
  const gJ = g(opp.rd / SCALE);
  const E = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
  const v = 1 / (gJ * gJ * E * (1 - E));
  const delta = v * gJ * (score - E);

  // New volatility (Illinois algorithm, step 5 of Glickman's paper)
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gJ * (score - E);
  return {
    rating: muNew * SCALE + START_RATING,
    rd: Math.max(MIN_RD, phiNew * SCALE),
    vol,
  };
}

// ---------- Views ----------

export interface RatingView {
  rating: number;
  division: DivisionId;
  provisional: boolean;
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export function ratingView(r: Rating, record: { played: number; wins: number; losses: number; draws: number }): RatingView {
  return { rating: Math.round(r.rating), division: divisionOf(r.rating), provisional: r.rd > PROVISIONAL_RD, ...record };
}

export type RankedProfile = Record<ModeId, RatingView>;

export interface RankedPlayerView {
  rating: number;
  division: DivisionId;
  provisional: boolean;
  /** Rating change from this match (null until it is over) */
  delta: number | null;
  /** Rating after the match (null until it is over) */
  after: number | null;
}

/** Ranked info of a room (null for friend lobbies). */
export interface RankedView {
  mode: ModeId;
  /** Division whose regions are played */
  division: DivisionId;
  /** Index = slot */
  players: RankedPlayerView[];
}

export interface RankedBoardEntry {
  rank: number;
  name: string;
  rating: number;
  division: DivisionId;
  played: number;
  you: boolean;
}

export interface RankedBoardResponse {
  mode: ModeId;
  entries: RankedBoardEntry[];
  you: RankedBoardEntry | null;
  players: number;
}

// ---------- Matchmaking protocol (browser ↔ Matchmaker Durable Object, over WebSocket) ----------

export type QueueClientMessage = { t: 'queue'; token: string; mode: ModeId } | { t: 'cancel' };

export type QueueServerMessage =
  | { t: 'queued'; mode: ModeId; rating: RatingView; now: number }
  /** Join room `code` with `ticket` as the session id (it is your seat). */
  | { t: 'matched'; code: string; ticket: string; mode: ModeId; opponent: { name: string; rating: number; division: DivisionId } }
  | { t: 'error'; message: string };

/** Rating gap two queued players accept; it widens with the longer wait so a quiet queue still matches. */
export function queueWindow(waitedMs: number): number {
  return 150 + 25 * Math.floor(waitedMs / 1000);
}

export function parseQueueMessage(raw: unknown): QueueClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  if (o.t === 'cancel') return { t: 'cancel' };
  if (o.t === 'queue' && typeof o.token === 'string' && /^[0-9a-f]{64}$/.test(o.token) && MODE_IDS.includes(o.mode as ModeId))
    return { t: 'queue', token: o.token, mode: o.mode as ModeId };
  return null;
}
