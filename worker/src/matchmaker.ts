import { DurableObject } from 'cloudflare:workers';
import {
  divisionOf,
  parseQueueMessage,
  queueWindow,
  randomRoomCode,
  type RankedModeId,
  type QueueServerMessage,
} from '@flagduel/shared';
import type { RankedSeat } from './room';

/** How often the queue is re-checked while someone is waiting (the rating window widens over time). */
export const PAIR_INTERVAL_MS = 1000;

/** A queued player, stored on their socket (survives hibernation). */
interface Waiting {
  userId: string;
  name: string;
  mode: RankedModeId;
  rating: number;
  provisional: boolean;
  joinedAt: number;
}

function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ranked queue. One instance ("main"). Each open WebSocket is one player waiting for a match in one
 * minigame; closing the socket leaves the queue. Two players are paired when their rating gap fits
 * the window of the one who has waited longer; they get a fresh ranked Room and a seat ticket each.
 */
export class Matchmaker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = parseQueueMessage(typeof raw === 'string' ? raw : null);
    if (!msg) return this.send(ws, { t: 'error', message: 'Malformed message' });
    if (msg.t === 'cancel') return ws.close(1000, 'cancelled');
    if (ws.deserializeAttachment()) return; // already queued

    const now = Date.now();
    const entry = await this.env.ACCOUNTS.getByName('main').rankedEntry(msg.token, msg.mode, now);
    if (!entry) {
      this.send(ws, { t: 'error', message: 'Please sign in again.' });
      return ws.close(4001, 'unauthorized');
    }
    if (entry.rating.locked) {
      this.send(ws, { t: 'error', message: 'Unlock ranked first: start as a beginner or take the placement test.' });
      return ws.close(4003, 'locked');
    }
    // One queue spot per account: a newer tab replaces the older one.
    for (const [other, w] of this.waiting()) {
      if (other !== ws && w.userId === entry.user.id) {
        this.send(other, { t: 'error', message: 'You started searching in another tab.' });
        other.serializeAttachment(null);
        other.close(4000, 'replaced');
      }
    }
    ws.serializeAttachment({
      userId: entry.user.id,
      name: entry.user.displayName,
      mode: msg.mode,
      rating: entry.rating.rating,
      provisional: entry.rating.provisional,
      joinedAt: now,
    } satisfies Waiting);
    this.send(ws, { t: 'queued', mode: msg.mode, rating: entry.rating, now });
    await this.pair(now);
  }

  async alarm() {
    await this.pair(Date.now());
  }

  /** Open sockets that are still waiting for a match. */
  private waiting(): [WebSocket, Waiting][] {
    const out: [WebSocket, Waiting][] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const w = ws.deserializeAttachment() as Waiting | null;
      if (w && ws.readyState === WebSocket.OPEN) out.push([ws, w]);
    }
    return out;
  }

  /** Pair everyone who can be paired now, oldest first; recheck later if anyone is left. */
  async pair(now: number) {
    const queue = this.waiting().sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    const taken = new Set<WebSocket>();
    const matches: [[WebSocket, Waiting], [WebSocket, Waiting]][] = [];
    for (const a of queue) {
      if (taken.has(a[0])) continue;
      // `a` has waited longest of what's left, so its window is the one that counts.
      const window = queueWindow(now - a[1].joinedAt);
      let best: [WebSocket, Waiting] | null = null;
      for (const b of queue) {
        if (b === a || taken.has(b[0]) || b[1].mode !== a[1].mode || b[1].userId === a[1].userId) continue;
        const gap = Math.abs(a[1].rating - b[1].rating);
        if (gap <= window && (!best || gap < Math.abs(a[1].rating - best[1].rating))) best = b;
      }
      if (best) {
        taken.add(a[0]).add(best[0]);
        matches.push([a, best]);
      }
    }
    // Out of the queue before any await, so an interleaved call can't pair them again.
    for (const ws of taken) ws.serializeAttachment(null);
    await Promise.all(matches.map((m) => this.startMatch(m[0], m[1])));

    if (this.waiting().length > 0) await this.ctx.storage.setAlarm(Date.now() + PAIR_INTERVAL_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  private async startMatch([wsA, a]: [WebSocket, Waiting], [wsB, b]: [WebSocket, Waiting]) {
    const seats: [RankedSeat, RankedSeat] = [a, b].map((w) => ({
      ticket: `rk${randomHex(16)}`,
      userId: w.userId,
      name: w.name,
      rating: w.rating,
      provisional: w.provisional,
    })) as [RankedSeat, RankedSeat];
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomRoomCode();
      if (!(await this.env.ROOMS.getByName(code).initRanked(code, a.mode, seats))) continue;
      const opponent = (w: Waiting) => ({ name: w.name, rating: w.rating, division: divisionOf(w.rating) });
      this.send(wsA, { t: 'matched', code, ticket: seats[0].ticket, mode: a.mode, opponent: opponent(b) });
      this.send(wsB, { t: 'matched', code, ticket: seats[1].ticket, mode: a.mode, opponent: opponent(a) });
      wsA.close(1000, 'matched');
      wsB.close(1000, 'matched');
      return;
    }
    for (const ws of [wsA, wsB]) {
      this.send(ws, { t: 'error', message: 'Could not start the match. Please search again.' });
      ws.close(1011, 'no_room');
    }
  }

  private send(ws: WebSocket, msg: QueueServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }
}
