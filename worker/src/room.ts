import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS,
  COUNTRY_BY_CODE,
  MIN_POOL_SIZE,
  RECONNECT_GRACE_MS,
  REGION_IDS,
  countriesInRegions,
  newRound,
  parseClientMessage,
  pickFlags,
  scoresOf,
  type ClientMessage,
  type ErrorCode,
  type MatchResult,
  type Phase,
  type RegionId,
  type RoomView,
  type RoundState,
  type RoundView,
  type ServerMessage,
  type Slot,
} from '@flagduel/shared';
import { FLAGS } from './generated/flags';

/** Delete a room's storage this long after the last player left. */
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;

interface Player {
  sessionId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  rematch: boolean;
}

interface GameState {
  codes: string[];
  /** Random per-round flag tokens (index = round) */
  tokens: string[];
  rounds: RoundState[];
  /** 0-based index of the current round, -1 during the countdown */
  current: number;
  countdownEndsAt: number | null;
  revealEndsAt: number | null;
  forfeitedBy: Slot | null;
  result: MatchResult | null;
}

export interface RoomState {
  code: string;
  createdAt: number;
  phase: Phase;
  /** Index = slot; slot 0 is the host */
  players: Player[];
  regions: RegionId[];
  game: GameState | null;
  /** When the last connected player left (for cleanup) */
  emptySince: number | null;
}

interface Attachment {
  sessionId: string;
}

function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? null;
    });
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------- RPC ----------

  /** Initialise a fresh room. Returns false if the code is already taken. */
  async init(code: string): Promise<boolean> {
    if (this.state) return false;
    const now = Date.now();
    this.state = {
      code,
      createdAt: now,
      phase: 'lobby',
      players: [],
      regions: [...REGION_IDS],
      game: null,
      // Nobody has joined yet; an unused room is cleaned up like an empty one.
      emptySince: now,
    };
    await this.commit();
    return true;
  }

  /** Public summary used by the join screen. */
  async summary(): Promise<{ phase: Phase; players: number } | null> {
    return this.state ? { phase: this.state.phase, players: this.state.players.length } : null;
  }

  /** SVG for a flag token of this room, only for rounds that have started. */
  async flag(token: string): Promise<string | null> {
    const g = this.state?.game;
    if (!g) return null;
    const i = g.tokens.indexOf(token);
    if (i < 0 || i > g.current) return null;
    return FLAGS[g.codes[i]] ?? null;
  }

  /** Test/debug helper: a copy of the internal state. */
  async debugState(): Promise<RoomState | null> {
    return structuredClone(this.state);
  }

  // ---------- WebSocket (hibernation API) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (!this.state) return new Response('Room not found', { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = parseClientMessage(typeof raw === 'string' ? raw : null);
    if (!msg) return this.sendError(ws, 'bad_message', 'Malformed message');
    if (!this.state) {
      this.sendError(ws, 'not_found', 'Room not found');
      return ws.close(4004, 'not_found');
    }
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'hello') return this.onHello(ws, msg);

    const slot = this.slotOf(ws);
    if (slot === null) return this.sendError(ws, 'not_allowed', 'Say hello first');
    await this.onPlayerMessage(ws, slot, msg);
  }

  async webSocketClose(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  async alarm() {
    await this.tick(Date.now());
  }

  // ---------- Handlers ----------

  private async onHello(ws: WebSocket, msg: Extract<ClientMessage, { t: 'hello' }>) {
    const s = this.state!;
    if (ws.deserializeAttachment()) return; // already identified
    let player = s.players.find((p) => p.sessionId === msg.sessionId);

    if (player) {
      // Reconnect: this socket replaces any older one for the same session.
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.sessionId === msg.sessionId) {
          other.close(4000, 'replaced');
        }
      }
      player.name = msg.name;
      player.connected = true;
      player.disconnectedAt = null;
    } else if (s.phase !== 'lobby') {
      this.sendError(ws, 'in_progress', 'A game is already running in this lobby');
      return ws.close(4003, 'in_progress');
    } else if (s.players.length >= 2) {
      this.sendError(ws, 'room_full', 'This lobby is full');
      return ws.close(4003, 'room_full');
    } else {
      player = { sessionId: msg.sessionId, name: msg.name, ready: false, connected: true, disconnectedAt: null, rematch: false };
      s.players.push(player);
    }

    ws.serializeAttachment({ sessionId: msg.sessionId } satisfies Attachment);
    s.emptySince = null;
    await this.commit();
  }

  private async onPlayerMessage(ws: WebSocket, slot: Slot, msg: ClientMessage) {
    const s = this.state!;
    switch (msg.t) {
      case 'setRegions':
        if (slot !== 0 || s.phase !== 'lobby') return this.sendError(ws, 'not_allowed', 'Only the host can change regions');
        s.regions = msg.regions;
        break;

      case 'ready':
        if (s.phase !== 'lobby') return;
        s.players[slot].ready = msg.ready;
        break;

      case 'start': {
        if (slot !== 0 || s.phase !== 'lobby') return this.sendError(ws, 'not_allowed', 'Only the host can start');
        if (s.players.length < 2 || !s.players.every((p) => p.ready && p.connected))
          return this.sendError(ws, 'not_allowed', 'Both players must be ready');
        if (countriesInRegions(s.regions).length < MIN_POOL_SIZE)
          return this.sendError(ws, 'pool_too_small', `Select regions with at least ${MIN_POOL_SIZE} countries`);
        this.startCountdown(Date.now());
        break;
      }

      case 'leave':
        if (s.phase === 'lobby') {
          this.removePlayer(slot);
          ws.close(1000, 'left');
        }
        // Leaving mid-game counts as giving up (milestone 3).
        break;

      default:
        // Round play (guess/pass/giveUp/rematch/backToLobby) arrives in milestone 3.
        return;
    }
    await this.commit();
  }

  private async onSocketGone(ws: WebSocket) {
    const s = this.state;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!s || !att) return;
    const stillOpen = this.ctx
      .getWebSockets()
      .some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.sessionId === att.sessionId);
    const player = s.players.find((p) => p.sessionId === att.sessionId);
    if (!player || stillOpen) return;
    const now = Date.now();
    player.connected = false;
    player.disconnectedAt = now;
    if (s.players.every((p) => !p.connected)) s.emptySince = now;
    await this.commit();
  }

  // ---------- Game flow ----------

  private startCountdown(now: number) {
    const s = this.state!;
    const codes = pickFlags(s.regions);
    s.game = {
      codes,
      tokens: codes.map(() => s.code + randomHex(8)),
      rounds: [],
      current: -1,
      countdownEndsAt: now + COUNTDOWN_MS,
      revealEndsAt: null,
      forfeitedBy: null,
      result: null,
    };
    s.phase = 'countdown';
    for (const p of s.players) p.rematch = false;
  }

  private startRound(i: number, now: number) {
    const s = this.state!;
    const g = s.game!;
    g.current = i;
    g.countdownEndsAt = null;
    g.revealEndsAt = null;
    g.rounds[i] = newRound(g.codes[i], now);
    s.phase = 'playing';
  }

  /** Process everything that is due at `now`. Called from the alarm. */
  async tick(now: number) {
    const s = this.state;
    if (!s) return;

    if (s.emptySince !== null && now >= s.emptySince + EMPTY_ROOM_TTL_MS) {
      await this.destroy();
      return;
    }

    const g = s.game;
    if (s.phase === 'countdown' && g?.countdownEndsAt && now >= g.countdownEndsAt) {
      this.startRound(0, now);
    }

    // Players who stayed away past the grace period.
    for (let slot = s.players.length - 1; slot >= 0; slot--) {
      const p = s.players[slot];
      if (p.connected || p.disconnectedAt === null || now < p.disconnectedAt + RECONNECT_GRACE_MS) continue;
      if (s.phase === 'lobby') this.removePlayer(slot as Slot);
      // Mid-game forfeits and leaving the results screen arrive in milestone 3.
    }

    await this.commit();
  }

  /** Remove a seat in the lobby; the guest becomes host if the host left. */
  private removePlayer(slot: Slot) {
    const s = this.state!;
    s.players.splice(slot, 1);
    for (const q of s.players) q.ready = false;
    if (!s.players.some((p) => p.connected)) s.emptySince ??= Date.now();
  }

  private nextAlarmAt(): number | null {
    const s = this.state;
    if (!s) return null;
    const times: number[] = [];
    if (s.emptySince !== null) times.push(s.emptySince + EMPTY_ROOM_TTL_MS);
    const g = s.game;
    if (s.phase === 'countdown' && g?.countdownEndsAt) times.push(g.countdownEndsAt);
    if (s.phase === 'lobby') {
      for (const p of s.players) if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + RECONNECT_GRACE_MS);
    }
    return times.length ? Math.min(...times) : null;
  }

  private async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'room_closed');
    this.state = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- Persistence & broadcast ----------

  /** Persist, reschedule the alarm, and push the new snapshot to everyone. */
  private async commit() {
    const s = this.state!;
    await this.ctx.storage.put('state', s);
    const at = this.nextAlarmAt();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
    this.broadcast();
  }

  private broadcast() {
    const room = this.view();
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const slot = this.slotOf(ws);
      if (slot !== null) this.send(ws, { t: 'state', room, you: slot, now });
    }
  }

  private view(): RoomView {
    const s = this.state!;
    const g = s.game;
    const cur = g && g.current >= 0 ? g.rounds[g.current] : undefined;
    const scores = g ? scoresOf(g.rounds) : [0, 0];
    const wrong = [0, 1].map((i) => g?.rounds.reduce((n, r) => n + r.wrong[i], 0) ?? 0);
    const roundView = (r: RoundState, i: number): RoundView => ({
      flag: g!.tokens[i],
      countryName: COUNTRY_BY_CODE[r.code].name,
      winner: r.winner,
      wrong: [r.wrong[0], r.wrong[1]],
      end: r.end!,
    });
    return {
      code: s.code,
      phase: s.phase,
      players: s.players.map((p, i) => ({
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        score: scores[i],
        wrongTotal: wrong[i],
        passed: !!cur?.passed[i],
        rematch: p.rematch,
      })),
      regions: s.regions,
      countryCount: countriesInRegions(s.regions).length,
      round: g ? g.current + 1 : 0,
      totalRounds: g ? g.codes.length : 10,
      flag: g && g.current >= 0 ? g.tokens[g.current] : null,
      countdownEndsAt: g?.countdownEndsAt ?? null,
      deadline: cur && !cur.end ? cur.deadline : null,
      revealEndsAt: g?.revealEndsAt ?? null,
      reveal: s.phase === 'reveal' && cur ? roundView(cur, g!.current) : null,
      history: g ? g.rounds.flatMap((r, i) => (r.end ? [roundView(r, i)] : [])) : [],
      result: g?.result ?? null,
    };
  }

  private slotOf(ws: WebSocket): Slot | null {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.state) return null;
    const i = this.state.players.findIndex((p) => p.sessionId === att.sessionId);
    return i === 0 || i === 1 ? i : null;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { t: 'error', code, message });
  }
}
