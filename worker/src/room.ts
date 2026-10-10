import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS,
  MATCH_INTRO_MS,
  COUNTRY_BY_CODE,
  MIN_POOL_SIZE,
  MODES,
  RECONNECT_GRACE_MS,
  REGION_IDS,
  revealMsOf,
  STAGE_INTRO_MS,
  DEFAULT_ROUND_COUNTS,
  DUEL_MAX_TIEBREAK,
  HIGHER_REVEAL_MS,
  SUDDEN_DEATH_INTRO_MS,
  applyDuelPick,
  applyDuelTimeout,
  applyDraft,
  applyGuess,
  applyPass,
  applyTimeout,
  decideMixed,
  duelMisses,
  duelRoundView,
  duelScores,
  newDuelRound,
  nextDuelPair,
  pairView,
  DIVISIONS,
  countriesInRegions,
  divisionOf,
  focusOf,
  isModeId,
  itemInfo,
  newRound,
  poolLabel,
  roundPoints,
  smallestPool,
  parseClientMessage,
  pickStages,
  pickStagesFrom,
  scoresOf,
  shuffleGames,
  stageAt,
  wrongTotalsOf,
  type ClientMessage,
  type DuelRound,
  type DuelView,
  type GameId,
  type Lock,
  type DivisionId,
  type ErrorCode,
  type ForfeitReason,
  type MatchResult,
  type ModeId,
  type Phase,
  type RegionId,
  type RankedModeId,
  type RankedView,
  type RoomView,
  type RoundCounts,
  type RoundState,
  type RoundView,
  type ServerMessage,
  type Slot,
} from '@flagduel/shared';
import type { RankedOutcome } from './accounts';

const IN_GAME: Phase[] = ['countdown', 'playing', 'reveal'];

const lockView = (l: Lock | null) => (l ? { answer: l.answer, correct: l.correct, accuracy: l.accuracy ?? null } : null);

/** Games a room plays: ranked its one minigame; friend lobbies what the host picked. */
function gamesOf(s: RoomState): GameId[] {
  if (s.ranked) return [s.ranked.mode];
  // Rooms stored before games could be mixed: kind 'higher' was a Higher or Lower duel.
  if (s.kind === 'higher') return ['higher'];
  return s.modes ?? ['flags'];
}

/** Rounds per game in a room; ranked matches always play the defaults. */
const roundCountsOf = (s: RoomState): RoundCounts =>
  s.ranked ? DEFAULT_ROUND_COUNTS : { ...DEFAULT_ROUND_COUNTS, ...s.roundCounts };

/** Game of each round (games stored before games could be mixed: all Higher or Lower, or all minigames). */
function roundGamesOf(g: GameState): GameId[] {
  if (g.roundModes?.length) return g.roundModes;
  return g.duel ? g.duel.rounds.map((): GameId => 'higher') : g.codes.map((): GameId => 'flags');
}

/** Where round `i` sits among the rounds of its kind: minigame rounds (g.rounds) or Higher or Lower (g.duel.rounds). */
function localIndex(games: readonly GameId[], i: number): number {
  const higher = games[i] === 'higher';
  let n = 0;
  for (let k = 0; k < i; k++) if ((games[k] === 'higher') === higher) n++;
  return n;
}

const regularOf = (g: GameState) => g.duel?.regular ?? DEFAULT_ROUND_COUNTS.higher;
const addPairs = (a: readonly number[], b: readonly number[]): [number, number] => [a[0] + b[0], a[1] + b[1]];

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
  /** Games in play order (absent in games stored before modes existed → flags) */
  stages?: GameId[];
  /** Game of each round (index = round); sudden-death Higher or Lower rounds are appended when needed */
  roundModes?: GameId[];
  /** Item of each round ('' for Higher or Lower rounds, whose pairs are drawn when they start) */
  codes: string[];
  /** Random per-round flag tokens (index = round; '' for Higher or Lower rounds) */
  tokens: string[];
  /** The minigame rounds, in order (Higher or Lower rounds live in `duel.rounds`) */
  rounds: RoundState[];
  /** 0-based index of the current round; during a countdown, the round before the one about to start */
  current: number;
  countdownEndsAt: number | null;
  revealEndsAt: number | null;
  forfeitedBy: Slot | null;
  forfeitReason: ForfeitReason | null;
  result: MatchResult | null;
  /**
   * The match's Higher or Lower rounds, if it has any. `regular`: its rounds before sudden death (absent in
   * duels stored before it was configurable → the default).
   */
  duel?: { pool: string[]; rounds: DuelRound[]; regular?: number };
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
  /** Games selected in the lobby (absent in rooms stored before modes existed → flags) */
  modes?: GameId[];
  /** Rooms stored before games could be mixed: 'higher' played a Higher or Lower duel instead of `modes` */
  kind?: 'classic' | 'higher';
  /** Rounds per game chosen by the host (absent in rooms stored before it existed → defaults) */
  roundCounts?: Partial<RoundCounts>;
  /** Play the games in a random order (drawn when each match starts) */
  shuffle?: boolean;
  game: GameState | null;
  /** Set for rooms made by the matchmaker: fixed seats, one match, rated when it ends */
  ranked?: RankedState;
  /** When the last connected player left (for cleanup) */
  emptySince: number | null;
}

interface RankedState {
  mode: RankedModeId;
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
  async initRanked(code: string, mode: RankedModeId, seats: [RankedSeat, RankedSeat]): Promise<boolean> {
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

  /** The item behind a flag/photo token of this room (only for rounds that have started); the Worker serves its image. */
  async flag(token: string): Promise<string | null> {
    const g = this.state?.game;
    if (!g) return null;
    const i = token ? g.tokens.indexOf(token) : -1;
    if (i < 0 || i > g.current) return null;
    return g.codes[i] ?? null;
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
      player = {
        sessionId: msg.sessionId,
        name: msg.name,
        ready: false,
        connected: true,
        disconnectedAt: null,
        rematch: false,
      };
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
    const LOBBY_ONLY: ClientMessage['t'][] = [
      'setRegions',
      'setModes',
      'setRounds',
      'setShuffle',
      'ready',
      'start',
      'rematch',
      'backToLobby',
    ];
    if (s.ranked && LOBBY_ONLY.includes(msg.t)) return this.sendError(ws, 'not_allowed', 'Not in a ranked match');
    switch (msg.t) {
      case 'setRegions':
        if (slot !== 0 || s.phase !== 'lobby')
          return this.sendError(ws, 'not_allowed', 'Only the host can change regions');
        s.regions = msg.regions;
        break;

      case 'setModes':
        if (slot !== 0 || s.phase !== 'lobby')
          return this.sendError(ws, 'not_allowed', 'Only the host can pick the games');
        s.modes = msg.modes;
        delete s.kind;
        break;

      case 'setRounds':
        if (slot !== 0 || s.phase !== 'lobby')
          return this.sendError(ws, 'not_allowed', 'Only the host can pick the games');
        s.roundCounts = { ...s.roundCounts, [msg.game]: msg.rounds };
        break;

      case 'setShuffle':
        if (slot !== 0 || s.phase !== 'lobby')
          return this.sendError(ws, 'not_allowed', 'Only the host can pick the games');
        s.shuffle = msg.shuffle;
        break;

      case 'ready':
        if (s.phase !== 'lobby') return;
        s.players[slot].ready = msg.ready;
        break;

      case 'start': {
        if (slot !== 0 || s.phase !== 'lobby') return this.sendError(ws, 'not_allowed', 'Only the host can start');
        if (s.players.length < 2 || !s.players.every((p) => p.ready && p.connected))
          return this.sendError(ws, 'not_allowed', 'Both players must be ready');
        const games = gamesOf(s);
        // Higher or Lower draws its pairs from the countries.
        if (games.includes('higher') && countriesInRegions(s.regions).length < MIN_POOL_SIZE)
          return this.sendError(ws, 'pool_too_small', `Select regions with at least ${MIN_POOL_SIZE} countries`);
        const modes = games.filter(isModeId);
        const small = modes.length ? smallestPool(s.regions, modes) : null;
        if (small && small.size < MIN_POOL_SIZE)
          return this.sendError(
            ws,
            'pool_too_small',
            `${MODES[small.mode].label} needs regions with at least ${poolLabel(small.mode, MIN_POOL_SIZE)}`,
          );
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
        // Correct, both players out of tries (map modes), or both locked in (lock-in modes).
        if (outcome !== 'ignored' && cur?.end) this.endRound(now);
        break;
      }

      case 'draft': {
        const cur = this.currentRound(msg.round);
        // Kept for the deadline only: stored, nothing to broadcast (nobody else may see it).
        if (cur && s.phase === 'playing' && applyDraft(cur, slot, msg.text, now)) await this.ctx.storage.put('state', s);
        return;
      }

      case 'pick': {
        // Higher or Lower: one final pick per player; the round ends once both are in.
        const g = s.game;
        const cur = g && s.phase === 'playing' && msg.round === g.current + 1 ? this.duelRoundAt(g.current) : null;
        if (!cur || !applyDuelPick(cur, slot, msg.code, now)) return;
        if (cur.end) this.endRound(now);
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
    // Random order: a new one every match (rematches too).
    const games = s.shuffle && !s.ranked ? shuffleGames(gamesOf(s)) : gamesOf(s);
    const counts = roundCountsOf(s);
    const modes = games.filter(isModeId);
    const count = (m: ModeId) => counts[m];
    const picked = s.pool ? pickStagesFrom(s.pool, modes, count) : pickStages(s.regions, modes, count);
    // One flat list of rounds in play order; Higher or Lower rounds get their pairs when they start.
    const codes: string[] = [];
    const roundModes: GameId[] = [];
    for (const game of games) {
      if (game === 'higher') {
        for (let k = 0; k < counts.higher; k++) {
          roundModes.push('higher');
          codes.push('');
        }
      } else {
        picked.roundModes.forEach((m, k) => {
          if (m !== game) return;
          roundModes.push(m);
          codes.push(picked.codes[k]);
        });
      }
    }
    s.game = {
      stages: games,
      roundModes,
      codes,
      tokens: codes.map((c) => (c ? s.code + randomHex(8) : '')),
      rounds: [],
      current: -1,
      countdownEndsAt: now + MATCH_INTRO_MS + COUNTDOWN_MS,
      revealEndsAt: null,
      forfeitedBy: null,
      forfeitReason: null,
      result: null,
    };
    if (games.includes('higher'))
      s.game.duel = { pool: s.pool ?? countriesInRegions(s.regions), rounds: [], regular: counts.higher };
    s.phase = 'countdown';
    for (const p of s.players) p.rematch = false;
    this.ctx.waitUntil(
      this.env.ACCOUNTS.getByName('main')
        .recordPlay(s.ranked ? 'ranked' : 'duel', games, s.players.length, now)
        .catch((e) => console.error('play count failed', e)),
    );
  }

  private startRound(i: number, now: number) {
    const s = this.state!;
    const g = s.game!;
    const games = roundGamesOf(g);
    g.current = i;
    g.countdownEndsAt = null;
    g.revealEndsAt = null;
    const k = localIndex(games, i);
    const game = games[i];
    if (game === 'higher')
      g.duel!.rounds[k] = newDuelRound(nextDuelPair(g.duel!.pool, g.duel!.rounds.slice(0, k)), now);
    else g.rounds[k] = newRound(g.codes[i], now, game);
    s.phase = 'playing';
  }

  private gameOf(i: number): GameId {
    return roundGamesOf(this.state!.game!)[i] ?? 'flags';
  }

  /** Minigame round `i` (0-based over the match), if it is one and has started. */
  private modeRoundAt(i: number): RoundState | undefined {
    const g = this.state?.game;
    if (!g || i < 0) return undefined;
    const games = roundGamesOf(g);
    return games[i] === 'higher' ? undefined : g.rounds[localIndex(games, i)];
  }

  /** Higher or Lower round `i` (0-based over the match), if it is one and has started. */
  private duelRoundAt(i: number): DuelRound | undefined {
    const g = this.state?.game;
    if (!g?.duel || i < 0) return undefined;
    const games = roundGamesOf(g);
    return games[i] === 'higher' ? g.duel.rounds[localIndex(games, i)] : undefined;
  }

  private currentAny(): RoundState | DuelRound | undefined {
    const g = this.state?.game;
    return g ? (this.modeRoundAt(g.current) ?? this.duelRoundAt(g.current)) : undefined;
  }

  /** The round a client message refers to (1-based), if it is the current one. */
  private currentRound(round: number): RoundState | null {
    const g = this.state?.game;
    if (!g || g.current < 0 || round !== g.current + 1) return null;
    return this.modeRoundAt(g.current) ?? null;
  }

  /** Points and wrong answers so far, over all games. */
  private totals(): { scores: [number, number]; wrong: [number, number] } {
    const g = this.state?.game;
    if (!g) return { scores: [0, 0], wrong: [0, 0] };
    const duel = g.duel?.rounds ?? [];
    return {
      scores: addPairs(scoresOf(g.rounds), duelScores(duel)),
      wrong: addPairs(wrongTotalsOf(g.rounds), duelMisses(duel)),
    };
  }

  /** The current round has just ended: show the answer to both players. */
  private endRound(now: number) {
    const s = this.state!;
    const game = this.gameOf(s.game!.current);
    s.phase = 'reveal';
    s.game!.revealEndsAt = now + (game === 'higher' ? HIGHER_REVEAL_MS : revealMsOf(game));
  }

  private finish() {
    const s = this.state!;
    const g = s.game!;
    g.result = decideMixed(g.rounds, g.duel?.rounds ?? null, regularOf(g), g.forfeitedBy);
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
    const cur = this.currentAny();
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
    if (s.phase === 'playing' && g) {
      const duelCur = this.duelRoundAt(g.current);
      const ended = duelCur ? applyDuelTimeout(duelCur, now) : applyTimeout(this.modeRoundAt(g.current)!, now);
      if (ended) this.endRound(now);
    }
    if (s.phase === 'reveal' && g?.revealEndsAt && now >= g.revealEndsAt) {
      const next = g.current + 1;
      if (next >= roundGamesOf(g).length) {
        // Tied with Higher or Lower in the match: sudden death, one Higher or Lower round at a time.
        const [a, b] = this.totals().scores;
        if (!g.duel || a !== b || g.duel.rounds.length >= regularOf(g) + DUEL_MAX_TIEBREAK) this.finish();
        else {
          const first = g.duel.rounds.length === regularOf(g);
          g.roundModes = [...roundGamesOf(g), 'higher'];
          g.codes.push('');
          g.tokens.push('');
          if (first) {
            // Announce sudden death before its first round.
            s.phase = 'countdown';
            g.revealEndsAt = null;
            g.countdownEndsAt = now + SUDDEN_DEATH_INTRO_MS;
          } else this.startRound(next, now);
        }
      } else if (this.gameOf(next) !== this.gameOf(g.current)) {
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
    const cur = this.currentAny();
    if (s.phase === 'playing' && cur) times.push(cur.deadline);
    if (s.phase === 'reveal' && g?.revealEndsAt) times.push(g.revealEndsAt);
    if (s.phase === 'lobby' || IN_GAME.includes(s.phase)) {
      for (const p of s.players)
        if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + RECONNECT_GRACE_MS);
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
      if (slot === null) continue;
      // Higher or Lower / lock-in games: each player sees their own pick, never the opponent's before the reveal.
      const higher = room.higher && { ...room.higher, mine: this.pickOf(slot) };
      this.send(ws, { t: 'state', room: { ...room, higher, myLock: this.lockOf(slot) }, you: slot, now });
    }
  }

  /** `slot`'s pick in the running duel round. */
  private pickOf(slot: Slot): string | null {
    const g = this.state?.game;
    return (g && this.duelRoundAt(g.current)?.picks[slot]) || null;
  }

  /** `slot`'s locked-in answer in the running lock-in round. */
  private lockOf(slot: Slot): string | null {
    const g = this.state?.game;
    const r = g ? this.modeRoundAt(g.current) : undefined;
    return r && !r.end ? (r.locks?.[slot]?.answer ?? null) : null;
  }

  private duelView(): DuelView | null {
    const s = this.state!;
    const g = s.game;
    if (!g?.duel) return null;
    const rounds = g.duel.rounds;
    const regular = regularOf(g);
    const counting = s.phase === 'countdown';
    const cur = counting ? undefined : this.duelRoundAt(g.current);
    return {
      // Higher or Lower rounds started so far (during a countdown: the ones already played)
      round: rounds.length,
      regularRounds: regular,
      // During a countdown the next round is about to start.
      tiebreak: (counting ? rounds.length : rounds.length - 1) >= regular,
      pair: cur ? pairView(cur.pair) : null,
      picked: [cur?.picks[0] != null, cur?.picks[1] != null],
      mine: null,
      reveal: s.phase === 'reveal' && cur ? duelRoundView(cur, rounds.length - 1, regular) : null,
      history: rounds.flatMap((r, i) => (r.end ? [duelRoundView(r, i, regular)] : [])),
    };
  }

  private view(): RoomView {
    const s = this.state!;
    const g = s.game;
    const games = g ? roundGamesOf(g) : [];
    const cur = g ? this.modeRoundAt(g.current) : undefined;
    const duelCur = g ? this.duelRoundAt(g.current) : undefined;
    const { scores, wrong } = this.totals();
    const counts = roundCountsOf(s);
    // Match-wide index of each minigame round (for its flag token)
    const modeIndex = games.flatMap((x, i) => (x === 'higher' ? [] : [i]));
    const roundView = (r: RoundState, i: number): RoundView => ({
      mode: r.mode ?? 'flags',
      flag: g!.tokens[i],
      code: r.code,
      ...itemInfo(r.mode ?? 'flags', r.code),
      winner: r.winner,
      wrong: [r.wrong[0], r.wrong[1]],
      points: roundPoints(r),
      locks: r.locks ? [lockView(r.locks[0]), lockView(r.locks[1])] : null,
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
        locked: !!cur?.locks?.[i],
        rematch: p.rematch,
        graceEndsAt:
          !p.connected && !p.left && p.disconnectedAt !== null && s.phase !== 'finished'
            ? p.disconnectedAt + RECONNECT_GRACE_MS
            : null,
        left: !!p.left,
      })),
      regions: s.regions,
      countryCount: s.pool?.length ?? countriesInRegions(s.regions).length,
      ...this.stageView(games),
      round: g ? g.current + 1 : 0,
      totalRounds: g ? games.length : gamesOf(s).reduce((n, x) => n + counts[x], 0),
      flag: g && g.current >= 0 && s.phase !== 'countdown' ? g.tokens[g.current] || null : null,
      countdownEndsAt: g?.countdownEndsAt ?? null,
      deadline: cur && !cur.end ? cur.deadline : duelCur && !duelCur.end ? duelCur.deadline : null,
      revealEndsAt: g?.revealEndsAt ?? null,
      reveal: s.phase === 'reveal' && cur ? roundView(cur, g!.current) : null,
      history: g ? g.rounds.flatMap((r, k) => (r.end ? [roundView(r, modeIndex[k])] : [])) : [],
      result: g?.result ?? null,
      forfeitReason: g?.forfeitReason ?? null,
      ranked: s.ranked ? rankedView(s.ranked) : null,
      roundCounts: counts,
      shuffle: !!s.shuffle && !s.ranked,
      higher: this.duelView(),
      myLock: null,
      misses:
        cur && (s.phase === 'playing' || s.phase === 'reveal') && MODES[cur.mode ?? 'flags'].input === 'map'
          ? [[...(cur.misses?.[0] ?? [])], [...(cur.misses?.[1] ?? [])]]
          : null,
    };
  }

  private stageView(
    games: GameId[],
  ): Pick<RoomView, 'modes' | 'stage' | 'stageRound' | 'stageRounds' | 'prompt' | 'focus'> {
    const s = this.state!;
    const g = s.game;
    const none = { prompt: null, focus: null };
    if (!g) {
      const modes = gamesOf(s);
      return { modes, stage: 0, stageRound: 0, stageRounds: roundCountsOf(s)[modes[0]], ...none };
    }
    const stages: GameId[] = g.stages?.length ? g.stages : g.duel ? ['higher'] : ['flags'];
    const counting = s.phase === 'countdown';
    const info = stageAt(games, counting ? g.current + 1 : g.current);
    const cur = counting ? undefined : this.modeRoundAt(g.current);
    const mode = isModeId(info.mode) ? info.mode : null;
    return {
      modes: stages,
      // Each game is one stage; sudden-death rounds belong to Higher or Lower wherever it was played.
      stage: Math.max(0, stages.indexOf(info.mode)),
      stageRound: counting ? 0 : g.current - info.start + 1,
      stageRounds: info.rounds,
      prompt: cur && mode ? (MODES[mode].promptText?.(cur.code) ?? null) : null,
      // The zoom point stays through the reveal, so the photo doesn't jump when the round ends.
      focus: cur && mode && MODES[mode].prompt === 'photo' ? focusOf(cur.code) : null,
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
