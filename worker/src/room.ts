import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS,
  MATCH_INTRO_MS,
  COUNTRY_BY_CODE,
  MIN_POOL_SIZE,
  MODES,
  RECONNECT_GRACE_MS,
  REGION_IDS,
  REVEAL_MS,
  ROUNDS_PER_GAME,
  STAGE_INTRO_MS,
  applyGuess,
  applyPass,
  applyTimeout,
  DIVISIONS,
  countriesInRegions,
  divisionOf,
  decideMatch,
  newRound,
  parseClientMessage,
  pickStages,
  pickStagesFrom,
  scoresOf,
  stageAt,
  type ClientMessage,
  type DivisionId,
  type ErrorCode,
  type ForfeitReason,
  type MatchResult,
  type ModeId,
  type Phase,
  type RegionId,
  type RankedView,
  type RoomView,
  type RoundState,
  type RoundView,
  type ServerMessage,
  type Slot,
} from '@flagduel/shared';
import type { RankedOutcome } from './accounts';
import { FLAGS } from './generated/flags';

const IN_GAME: Phase[] = ['countdown', 'playing', 'reveal'];

/** Delete a room's storage this long after the last player left. */
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;

interface Player {
  sessionId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  rematch: boolean;
  /** Left mid-game or from the results screen; never comes back. */
  left?: boolean;
}

interface GameState {
  /** Minigames in play order (absent in games stored before modes existed → flags) */
  stages?: ModeId[];
  /** Minigame of each round (index = round) */
  roundModes?: ModeId[];
  codes: string[];
  /** Random per-round flag tokens (index = round) */
  tokens: string[];
  rounds: RoundState[];
  /** 0-based index of the current round; during a countdown, the round before the one about to start */
  current: number;
  countdownEndsAt: number | null;
  revealEndsAt: number | null;
  forfeitedBy: Slot | null;
  forfeitReason: ForfeitReason | null;
  result: MatchResult | null;
}

export interface RoomState {
  code: string;
  createdAt: number;
  phase: Phase;
  /** Index = slot; slot 0 is the host */
  players: Player[];
  regions: RegionId[];
  /** Ranked rooms: the division's countries, played instead of the regions */
  pool?: string[];
  /** Minigames selected in the lobby (absent in rooms stored before modes existed → flags) */
  modes?: ModeId[];
  game: GameState | null;
  /** Set for rooms made by the matchmaker: fixed seats, one match, rated when it ends */
  ranked?: RankedState;
  /** When the last connected player left (for cleanup) */
  emptySince: number | null;
}

interface RankedState {
  mode: ModeId;
  /** Division whose countries are played (the lower of the two players') */
  division: DivisionId;
  /** Idempotency key for rating the match */
  matchId: string;
  /** Index = slot */
  players: { userId: string; rating: number; provisional: boolean }[];
  /** Rating changes, once the match is rated */
  outcome: RankedOutcome[] | null;
}

export interface RankedSeat {
  /** Secret session id that claims this seat (handed to the player by the matchmaker) */
  ticket: string;
  userId: string;
  name: string;
  rating: number;
  provisional: boolean;
}

interface Attachment {
  sessionId: string;
}

const rankedView = (r: RankedState): RankedView => ({
  mode: r.mode,
  division: r.division,
  players: r.players.map((p, i) => ({
    rating: p.rating,
    division: divisionOf(p.rating),
    provisional: p.provisional,
    delta: r.outcome?.[i].delta ?? null,
    after: r.outcome?.[i].after ?? null,
  })),
});

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
      modes: ['flags'],
      game: null,
      // Nobody has joined yet; an unused room is cleaned up like an empty one.
      emptySince: now,
    };
    await this.commit();
    return true;
  }

  /**
   * Initialise a ranked room for two matched players. Both seats are taken up front (claimed with
   * their tickets); the match starts as soon as both are connected. Returns false if the code is taken.
   */
  async initRanked(code: string, mode: ModeId, seats: [RankedSeat, RankedSeat]): Promise<boolean> {
    if (this.state) return false;
    const now = Date.now();
    const division = divisionOf(Math.min(seats[0].rating, seats[1].rating));
    this.state = {
      code,
      createdAt: now,
      phase: 'lobby',
      // Not connected yet: whoever doesn't show up within the reconnect grace cancels the match.
      players: seats.map((p) => ({
        sessionId: p.ticket,
        name: p.name,
        ready: true,
        connected: false,
        disconnectedAt: now,
        rematch: false,
      })),
      // Shown as chips only; the rounds come from the pool.
      regions: REGION_IDS.filter((r) => DIVISIONS[division].countries.some((c) => COUNTRY_BY_CODE[c]?.region === r)),
      pool: [...DIVISIONS[division].countries],
      modes: [mode],
      game: null,
      ranked: {
        mode,
        division,
        matchId: `${code}:${now}`,
        players: seats.map((p) => ({ userId: p.userId, rating: p.rating, provisional: p.provisional })),
        outcome: null,
      },
      emptySince: null,
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

    if (player?.left) {
      this.sendError(ws, 'in_progress', 'You left this game');
      return ws.close(4003, 'left');
    } else if (player) {
      // Reconnect: this socket replaces any older one for the same session.
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.sessionId === msg.sessionId) {
          other.close(4000, 'replaced');
        }
      }
      // Ranked seats keep the account name the matchmaker put there.
      if (!s.ranked) player.name = msg.name;
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
    // Ranked: both players are here → go.
    if (s.ranked && s.phase === 'lobby' && s.players.every((p) => p.connected)) this.startCountdown(Date.now());
    await this.commit();
  }

  private async onPlayerMessage(ws: WebSocket, slot: Slot, msg: ClientMessage) {
    const s = this.state!;
    const now = Date.now();
    // Ranked rooms are set up by the matchmaker and hold exactly one match.
    const LOBBY_ONLY: ClientMessage['t'][] = ['setRegions', 'setModes', 'ready', 'start', 'rematch', 'backToLobby'];
    if (s.ranked && LOBBY_ONLY.includes(msg.t)) return this.sendError(ws, 'not_allowed', 'Not in a ranked match');
    switch (msg.t) {
      case 'setRegions':
        if (slot !== 0 || s.phase !== 'lobby') return this.sendError(ws, 'not_allowed', 'Only the host can change regions');
        s.regions = msg.regions;
        break;

      case 'setModes':
        if (slot !== 0 || s.phase !== 'lobby') return this.sendError(ws, 'not_allowed', 'Only the host can pick the games');
        s.modes = msg.modes;
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
        this.startCountdown(now);
        break;
      }

      case 'guess': {
        // Every guess gets exactly one guessResult so the client can match replies in order.
        const cur = this.currentRound(msg.round);
        const outcome = cur && s.phase === 'playing' ? applyGuess(cur, slot, msg.text, now) : 'ignored';
        this.send(ws, { t: 'guessResult', round: msg.round, outcome });
        if (outcome === 'ignored') {
          // A guess arriving after the deadline ends the round (the alarm may not have fired yet).
          if (cur?.end === 'timeout' && s.phase === 'playing') this.endRound(now);
          else return;
        }
        if (outcome === 'wrong') this.sendToSlot(slot === 0 ? 1 : 0, { t: 'oppWrong', round: msg.round });
        // Correct, or both players out of tries (map modes).
        if (outcome === 'correct' || cur?.end === 'passed') this.endRound(now);
        break;
      }

      case 'pass': {
        const cur = this.currentRound(msg.round);
        if (!cur || s.phase !== 'playing' || cur.passed[slot]) return;
        if (applyPass(cur, slot, now)) this.endRound(now);
        break;
      }

      case 'giveUp':
        if (!IN_GAME.includes(s.phase)) return;
        this.forfeit(slot, 'gaveUp', now);
        break;

      case 'rematch': {
        if (s.phase !== 'finished') return;
        if (s.players.length < 2 || !s.players.every((p) => p.connected))
          return this.sendError(ws, 'not_allowed', 'Your opponent has left');
        s.players[slot].rematch = true;
        if (s.players.every((p) => p.rematch)) this.startCountdown(now);
        break;
      }

      case 'backToLobby':
        if (s.phase !== 'finished') return;
        this.toLobby();
        break;

      case 'leave':
        ws.close(1000, 'left');
        if (s.ranked && s.phase === 'lobby') {
          return this.cancelRanked('Your opponent left before the match started. Nothing was rated.');
        } else if (s.phase === 'lobby') {
          this.removePlayer(slot);
        } else {
          // Leaving mid-game counts as giving up; afterwards the seat is gone for good.
          if (IN_GAME.includes(s.phase)) this.forfeit(slot, 'left', now);
          const p = s.players[slot];
          p.connected = false;
          p.disconnectedAt = now;
          p.left = true;
          if (!s.players.some((q) => q.connected)) s.emptySince = now;
        }
        break;

      default:
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
    if (!player || stillOpen || !player.connected) return;
    const now = Date.now();
    player.connected = false;
    player.disconnectedAt = now;
    if (s.players.every((p) => !p.connected)) s.emptySince = now;
    await this.commit();
  }

  // ---------- Game flow ----------

  private startCountdown(now: number) {
    const s = this.state!;
    const stages = s.modes ?? ['flags'];
    const { codes, roundModes } = s.pool ? pickStagesFrom(s.pool, stages) : pickStages(s.regions, stages);
    s.game = {
      stages,
      roundModes,
      codes,
      tokens: codes.map(() => s.code + randomHex(8)),
      rounds: [],
      current: -1,
      countdownEndsAt: now + MATCH_INTRO_MS + COUNTDOWN_MS,
      revealEndsAt: null,
      forfeitedBy: null,
      forfeitReason: null,
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
    g.rounds[i] = newRound(g.codes[i], now, this.modeOf(i));
    s.phase = 'playing';
  }

  private modeOf(i: number): ModeId {
    return this.state!.game!.roundModes?.[i] ?? 'flags';
  }

  /** The round a client message refers to (1-based), if it is the current one. */
  private currentRound(round: number): RoundState | null {
    const g = this.state?.game;
    if (!g || g.current < 0 || round !== g.current + 1) return null;
    return g.rounds[g.current];
  }

  /** The current round has just ended: show the answer to both players. */
  private endRound(now: number) {
    const s = this.state!;
    s.phase = 'reveal';
    s.game!.revealEndsAt = now + REVEAL_MS;
  }

  private finish() {
    const s = this.state!;
    const g = s.game!;
    g.result = decideMatch(g.rounds, g.forfeitedBy);
    g.countdownEndsAt = null;
    g.revealEndsAt = null;
    s.phase = 'finished';
    for (const p of s.players) {
      p.ready = false;
      p.rematch = false;
    }
  }

  private forfeit(slot: Slot, reason: ForfeitReason, now: number) {
    const g = this.state!.game!;
    const cur = g.current >= 0 ? g.rounds[g.current] : undefined;
    if (cur && !cur.end) {
      cur.end = 'forfeit';
      cur.endedAt = now;
    }
    g.forfeitedBy = slot;
    g.forfeitReason = reason;
    this.finish();
  }

  /** Results → lobby with the same settings; players who are gone lose their seat. */
  private toLobby() {
    const s = this.state!;
    s.phase = 'lobby';
    s.game = null;
    for (let i = s.players.length - 1; i >= 0; i--) if (!s.players[i].connected) s.players.splice(i, 1);
    for (const p of s.players) {
      p.ready = false;
      p.rematch = false;
    }
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
      this.startRound(g.current + 1, now);
    }
    if (s.phase === 'playing' && g && applyTimeout(g.rounds[g.current], now)) {
      this.endRound(now);
    }
    if (s.phase === 'reveal' && g?.revealEndsAt && now >= g.revealEndsAt) {
      const next = g.current + 1;
      if (next >= g.codes.length) this.finish();
      else if (this.modeOf(next) !== this.modeOf(g.current)) {
        // Next minigame: short "Next up" countdown before its first round.
        s.phase = 'countdown';
        g.revealEndsAt = null;
        g.countdownEndsAt = now + STAGE_INTRO_MS;
      } else this.startRound(next, now);
    }

    // Players who stayed away past the grace period.
    for (let slot = s.players.length - 1; slot >= 0; slot--) {
      const p = s.players[slot];
      if (p.connected || p.disconnectedAt === null || now < p.disconnectedAt + RECONNECT_GRACE_MS) continue;
      if (s.ranked && s.phase === 'lobby') return this.cancelRanked("Your opponent didn't join. Nothing was rated.");
      if (s.phase === 'lobby') this.removePlayer(slot as Slot);
      else if (IN_GAME.includes(s.phase)) this.forfeit(slot as Slot, 'disconnected', now);
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
    if (s.phase === 'playing' && g) times.push(g.rounds[g.current].deadline);
    if (s.phase === 'reveal' && g?.revealEndsAt) times.push(g.revealEndsAt);
    if (s.phase === 'lobby' || IN_GAME.includes(s.phase)) {
      for (const p of s.players) if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + RECONNECT_GRACE_MS);
    }
    return times.length ? Math.min(...times) : null;
  }

  /** A ranked match that never started: tell whoever is here, then close the room. */
  private async cancelRanked(message: string) {
    for (const ws of this.ctx.getWebSockets()) this.sendError(ws, 'not_found', message);
    await this.destroy();
  }

  /** Rate a finished ranked match (once; Accounts ignores repeats of the same match id). */
  private async rate() {
    const r = this.state!.ranked!;
    const result = this.state!.game?.result;
    if (!result) return;
    try {
      r.outcome = await this.env.ACCOUNTS.getByName('main').rankedResult(
        r.matchId,
        r.mode,
        [r.players[0].userId, r.players[1].userId],
        result.winner,
      );
    } catch (e) {
      console.error('rating failed', r.matchId, e);
    }
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
    if (s.ranked && s.phase === 'finished' && !s.ranked.outcome) await this.rate();
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
    const roundModes = g?.roundModes ?? g?.codes.map((): ModeId => 'flags') ?? [];
    const roundView = (r: RoundState, i: number): RoundView => ({
      mode: r.mode ?? 'flags',
      flag: g!.tokens[i],
      code: r.code,
      countryName: COUNTRY_BY_CODE[r.code].name,
      answer: MODES[r.mode ?? 'flags'].answerOf(r.code),
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
        graceEndsAt:
          !p.connected && !p.left && p.disconnectedAt !== null && s.phase !== 'finished'
            ? p.disconnectedAt + RECONNECT_GRACE_MS
            : null,
        left: !!p.left,
      })),
      regions: s.regions,
      countryCount: s.pool?.length ?? countriesInRegions(s.regions).length,
      ...this.stageView(roundModes),
      round: g ? g.current + 1 : 0,
      totalRounds: g ? g.codes.length : ROUNDS_PER_GAME * (s.modes ?? ['flags']).length,
      flag: g && g.current >= 0 && s.phase !== 'countdown' ? g.tokens[g.current] : null,
      countdownEndsAt: g?.countdownEndsAt ?? null,
      deadline: cur && !cur.end ? cur.deadline : null,
      revealEndsAt: g?.revealEndsAt ?? null,
      reveal: s.phase === 'reveal' && cur ? roundView(cur, g!.current) : null,
      history: g ? g.rounds.flatMap((r, i) => (r.end ? [roundView(r, i)] : [])) : [],
      result: g?.result ?? null,
      forfeitReason: g?.forfeitReason ?? null,
      ranked: s.ranked ? rankedView(s.ranked) : null,
    };
  }

  private stageView(roundModes: ModeId[]): Pick<RoomView, 'modes' | 'stage' | 'stageRound' | 'stageRounds' | 'prompt'> {
    const s = this.state!;
    const g = s.game;
    if (!g) return { modes: s.modes ?? ['flags'], stage: 0, stageRound: 0, stageRounds: ROUNDS_PER_GAME, prompt: null };
    const counting = s.phase === 'countdown';
    const info = stageAt(roundModes, counting ? g.current + 1 : g.current);
    const cur = g.current >= 0 && !counting ? g.rounds[g.current] : undefined;
    return {
      modes: g.stages ?? ['flags'],
      stage: info.stage,
      stageRound: counting ? 0 : g.current - info.start + 1,
      stageRounds: info.rounds,
      prompt: cur && MODES[info.mode].showsCountry ? COUNTRY_BY_CODE[cur.code].name : null,
    };
  }

  private sendToSlot(slot: Slot, msg: ServerMessage) {
    for (const ws of this.ctx.getWebSockets()) if (this.slotOf(ws) === slot) this.send(ws, msg);
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
