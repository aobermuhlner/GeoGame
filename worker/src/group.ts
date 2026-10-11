import { DurableObject } from 'cloudflare:workers';
import {
  CHAT_HISTORY,
  CHAT_MIN_GAP_MS,
  GAME_IDS,
  GROUP_DEFAULT_ROUND_COUNTS,
  GROUP_MAX_PLAYERS,
  GROUP_MIN_PLAYERS,
  GROUP_STAGE_INTRO_MS,
  GROUP_STANDINGS_MS,
  MATCH_GAMES,
  MODES,
  QUICK_FILL_MS,
  QUICK_ROUNDS,
  RECONNECT_GRACE_MS,
  REGION_IDS,
  countriesInRegions,
  focusOf,
  groupDraft,
  groupGuess,
  groupPass,
  groupPick,
  groupRevealMsOf,
  isModeId,
  itemInfo,
  newGroupRound,
  pairView,
  parseClientMessage,
  pickGroupPairs,
  pickStages,
  pickVotedGames,
  playableGames,
  ranksOf,
  revealedPair,
  settleGroupRound,
  tallyOf,
  type ChatLine,
  type ClientMessage,
  type Entry,
  type EntryStatus,
  type ErrorCode,
  type GameId,
  type GroupEntryView,
  type GroupPhase,
  type GroupRound,
  type GroupServerMessage,
  type GroupView,
  type HigherPair,
  type ModeId,
  type RegionId,
  type RoundCounts,
  type StandingView,
} from '@flagduel/shared';

const IN_GAME: GroupPhase[] = ['countdown', 'playing', 'reveal', 'standings'];

/** Delete a room's storage this long after the last player left. */
export const EMPTY_GROUP_TTL_MS = 10 * 60_000;

interface Player {
  sessionId: string;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
  /** Left mid-game or from the results; keeps its place in the ranking but never comes back. */
  left?: boolean;
  /** The games they vote for (absent in rooms stored before votes existed) */
  votes?: GameId[];
  /** When they last said something in the chat */
  lastChatAt?: number;
}

interface GameState {
  /** Games in play order */
  stages: GameId[];
  /** Game of each round (index = round) */
  roundGames: GameId[];
  /** Item of each minigame round ('' for Higher or Lower) */
  codes: string[];
  /** Pair of each Higher or Lower round (null for minigame rounds) */
  pairs: (HigherPair | null)[];
  /** Random per-round image tokens ('' for Higher or Lower) */
  tokens: string[];
  rounds: GroupRound[];
  /** 0-based index of the current round; during a countdown, the round before the one about to start */
  current: number;
  countdownEndsAt: number | null;
  revealEndsAt: number | null;
  standingsEndsAt: number | null;
}

export interface GroupState {
  code: string;
  createdAt: number;
  phase: GroupPhase;
  /** Index = seat; seat 0 is the host */
  players: Player[];
  regions: RegionId[];
  /** Games of the last match (the next one's are picked by vote when it starts) */
  modes: GameId[];
  roundCounts: RoundCounts;
  /** A public game ("Find a game"): fixed settings, no host controls, starts on its own */
  public?: boolean;
  /** Public lobby: when the match starts; set once two players are in */
  autoStartAt?: number | null;
  game: GameState | null;
  emptySince: number | null;
  /** The last CHAT_HISTORY chat lines (absent in rooms stored before the chat existed) */
  chat?: ChatLine[];
  /** Id of the next chat line */
  chatSeq?: number;
}

interface Attachment {
  sessionId: string;
}

function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where the game of round `i` starts and how many rounds it has. */
function stageSpan(games: readonly GameId[], i: number): { start: number; rounds: number } {
  let start = i;
  while (start > 0 && games[start - 1] === games[i]) start--;
  let end = i;
  while (end + 1 < games.length && games[end + 1] === games[i]) end++;
  return { start, rounds: end - start + 1 };
}

const entryView = (r: GroupRound, e: Entry): GroupEntryView => ({
  end: e.end,
  answer: e.answer,
  accuracy: e.accuracy ?? null,
  wrong: e.wrong,
  points: e.points,
  timeMs: e.end === 'correct' && e.at !== null ? e.at - r.startedAt : null,
});

function statusOf(r: GroupRound, e: Entry): EntryStatus {
  if (!e.end) return 'thinking';
  if (e.end === 'passed') return 'passed';
  // Lock-in games and Higher or Lower: right or wrong stays hidden until the reveal.
  if (r.game === 'higher' || MODES[r.game].lockIn) return 'locked';
  return e.end === 'correct' ? 'correct' : 'out';
}

/**
 * A group lobby: up to 8 players, everyone answers every round. The players vote for the games (the
 * MATCH_GAMES most voted are played, in random order), the host picks the regions and rounds;
 * after each game the standings show who moved up or down, and the match ends on a podium.
 */
export class GroupRoom extends DurableObject<Env> {
  private state: GroupState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<GroupState>('state')) ?? null;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------- RPC ----------

  /** `isPublic`: a "Find a game" lobby — voted games, every region, starts on its own. */
  async init(code: string, isPublic = false): Promise<boolean> {
    if (this.state) return false;
    const now = Date.now();
    this.state = {
      code,
      createdAt: now,
      phase: 'lobby',
      players: [],
      regions: [...REGION_IDS],
      modes: [],
      roundCounts: isPublic
        ? (Object.fromEntries(GAME_IDS.map((g) => [g, QUICK_ROUNDS])) as RoundCounts)
        : { ...GROUP_DEFAULT_ROUND_COUNTS },
      public: isPublic,
      autoStartAt: null,
      game: null,
      emptySince: now,
    };
    await this.commit();
    return true;
  }

  async summary(): Promise<{
    phase: GroupPhase;
    players: number;
    public: boolean;
    autoStartAt: number | null;
  } | null> {
    const s = this.state;
    return s
      ? { phase: s.phase, players: s.players.length, public: !!s.public, autoStartAt: s.autoStartAt ?? null }
      : null;
  }

  /** The item behind an image token (only for rounds that have started). */
  async flag(token: string): Promise<string | null> {
    const g = this.state?.game;
    if (!g) return null;
    const i = token ? g.tokens.indexOf(token) : -1;
    if (i < 0 || i > g.current) return null;
    return g.codes[i] || null;
  }

  async debugState(): Promise<GroupState | null> {
    return structuredClone(this.state);
  }

  /** Tests: start a match with these games in this order (and rounds), as if the votes had picked them. */
  async debugStart(games: GameId[], rounds: Partial<RoundCounts> = {}): Promise<void> {
    const s = this.state!;
    s.roundCounts = { ...s.roundCounts, ...rounds };
    this.startMatch(Date.now(), games);
    await this.commit();
  }

  // ---------- WebSocket ----------

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
    const seat = this.seatOf(ws);
    if (seat === null) return this.sendError(ws, 'not_allowed', 'Say hello first');
    await this.onPlayerMessage(ws, seat, msg);
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
    if (ws.deserializeAttachment()) return;
    let player = s.players.find((p) => p.sessionId === msg.sessionId);
    if (player?.left) {
      this.sendError(ws, 'in_progress', 'You left this game');
      return ws.close(4003, 'left');
    } else if (player) {
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
    } else if (s.players.length >= GROUP_MAX_PLAYERS) {
      this.sendError(ws, 'room_full', `This lobby is full (${GROUP_MAX_PLAYERS} players)`);
      return ws.close(4003, 'room_full');
    } else {
      player = { sessionId: msg.sessionId, name: msg.name, connected: true, disconnectedAt: null, votes: [] };
      s.players.push(player);
    }
    ws.serializeAttachment({ sessionId: msg.sessionId } satisfies Attachment);
    s.emptySince = null;
    await this.commit();
    this.send(ws, { t: 'chat', lines: s.chat ?? [], reset: true });
  }

  private async onPlayerMessage(ws: WebSocket, seat: number, msg: ClientMessage) {
    const s = this.state!;
    const now = Date.now();
    const hostOnly = (what: string) => {
      if (s.public) {
        this.sendError(ws, 'not_allowed', 'Public games start on their own');
        return false;
      }
      if (seat !== 0 || s.phase !== 'lobby') {
        this.sendError(ws, 'not_allowed', `Only the host can ${what}`);
        return false;
      }
      return true;
    };
    switch (msg.t) {
      case 'chat': {
        const p = s.players[seat];
        if (p.left) return;
        if (p.lastChatAt !== undefined && now - p.lastChatAt < CHAT_MIN_GAP_MS)
          return this.sendError(ws, 'not_allowed', 'Slow down a little');
        p.lastChatAt = now;
        const line: ChatLine = { id: s.chatSeq ?? 1, seat, name: p.name, text: msg.text, at: now };
        s.chatSeq = line.id + 1;
        s.chat = [...(s.chat ?? []), line].slice(-CHAT_HISTORY);
        // Only the new line goes out; the room snapshot doesn't change.
        await this.ctx.storage.put('state', s);
        for (const other of this.ctx.getWebSockets())
          if (this.seatOf(other) !== null) this.send(other, { t: 'chat', lines: [line], reset: false });
        return;
      }

      case 'setRegions':
        if (!hostOnly('change regions')) return;
        s.regions = msg.regions;
        break;

      case 'vote':
        // Everyone votes, in public games too.
        if (s.phase !== 'lobby') return;
        s.players[seat].votes = msg.games;
        break;

      case 'setAllRounds':
        if (!hostOnly('change the rounds')) return;
        s.roundCounts = Object.fromEntries(GAME_IDS.map((g) => [g, msg.rounds])) as RoundCounts;
        break;

      case 'start': {
        if (!hostOnly('start')) return;
        if (s.players.filter((p) => p.connected).length < GROUP_MIN_PLAYERS)
          return this.sendError(ws, 'not_allowed', `At least ${GROUP_MIN_PLAYERS} players are needed`);
        const games = this.votedGames();
        if (!games.length)
          return this.sendError(ws, 'pool_too_small', 'The selected regions are too small for any game: add regions');
        this.startMatch(now, games);
        break;
      }

      case 'guess': {
        const r = this.currentRound(msg.round);
        const outcome = r && s.phase === 'playing' ? groupGuess(r, seat, msg.text, now) : 'ignored';
        this.send(ws, { t: 'guessResult', round: msg.round, outcome });
        if (outcome === 'ignored' || outcome === 'invalid') {
          // A late guess may be the first to notice the deadline.
          if (!r || s.phase !== 'playing' || now < r.deadline) return;
        }
        this.settle(now);
        break;
      }

      case 'draft': {
        const r = this.currentRound(msg.round);
        // Kept for the deadline only: stored, nothing to broadcast (nobody else may see it).
        if (r && s.phase === 'playing' && groupDraft(r, seat, msg.text, now)) await this.ctx.storage.put('state', s);
        return;
      }

      case 'pick': {
        const r = this.currentRound(msg.round);
        if (!r || s.phase !== 'playing' || !groupPick(r, seat, msg.code, now)) return;
        this.settle(now);
        break;
      }

      case 'pass': {
        const r = this.currentRound(msg.round);
        if (!r || s.phase !== 'playing' || !groupPass(r, seat, now)) return;
        this.settle(now);
        break;
      }

      case 'backToLobby':
        // A public game holds one match: "play again" finds a new one.
        if (s.phase !== 'finished' || s.public) return;
        this.toLobby();
        break;

      case 'leave':
        ws.close(1000, 'left');
        if (s.phase === 'lobby') this.removePlayer(seat);
        else {
          // Mid-game: the seat stays in the ranking, the rounds stop waiting for it.
          const p = s.players[seat];
          p.connected = false;
          p.disconnectedAt = now;
          p.left = true;
          if (!s.players.some((q) => q.connected)) s.emptySince = now;
          if (s.phase === 'playing') this.settle(now);
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

  /** The next match's games: the most voted by the players who are here, in random order. */
  private votedGames(): GameId[] {
    const s = this.state!;
    const votes = s.players.filter((p) => p.connected && !p.left).map((p) => p.votes ?? []);
    return pickVotedGames(votes, playableGames(s.regions), MATCH_GAMES);
  }

  private startMatch(now: number, games: GameId[]) {
    const s = this.state!;
    s.modes = games;
    const counts = s.roundCounts;
    const picked = pickStages(s.regions, games.filter(isModeId), (m: ModeId) => counts[m]);
    const pool = countriesInRegions(s.regions);
    const roundGames: GameId[] = [];
    const codes: string[] = [];
    const pairs: (HigherPair | null)[] = [];
    for (const game of games) {
      if (game === 'higher') {
        for (const p of pickGroupPairs(pool, counts.higher)) {
          roundGames.push('higher');
          codes.push('');
          pairs.push(p);
        }
      } else {
        picked.roundModes.forEach((m, k) => {
          if (m !== game) return;
          roundGames.push(m);
          codes.push(picked.codes[k]);
          pairs.push(null);
        });
      }
    }
    s.game = {
      stages: [...games],
      roundGames,
      codes,
      pairs,
      tokens: codes.map((c) => (c ? s.code + randomHex(8) : '')),
      rounds: [],
      current: -1,
      countdownEndsAt: now + GROUP_STAGE_INTRO_MS,
      revealEndsAt: null,
      standingsEndsAt: null,
    };
    s.phase = 'countdown';
    const players = s.players.filter((p) => p.connected).length;
    this.ctx.waitUntil(
      this.env.ACCOUNTS.getByName('main')
        .recordPlay(s.public ? 'quick' : 'group', games, players, now)
        .catch((e) => console.error('play count failed', e)),
    );
  }

  private startRound(i: number, now: number) {
    const s = this.state!;
    const g = s.game!;
    g.current = i;
    g.countdownEndsAt = null;
    g.revealEndsAt = null;
    g.standingsEndsAt = null;
    g.rounds[i] = newGroupRound(g.roundGames[i], g.codes[i], g.pairs[i], s.players.length, now);
    s.phase = 'playing';
  }

  private currentRound(round: number): GroupRound | null {
    const g = this.state?.game;
    if (!g || g.current < 0 || round !== g.current + 1) return null;
    return g.rounds[g.current] ?? null;
  }

  /** Players the running round waits for. */
  private active(): boolean[] {
    return this.state!.players.map((p) => p.connected && !p.left);
  }

  /** End the running round if everyone is done or time is up. */
  private settle(now: number) {
    const s = this.state!;
    const g = s.game;
    const r = g?.rounds[g.current];
    if (s.phase !== 'playing' || !r) return;
    if (!settleGroupRound(r, this.active(), now)) return;
    s.phase = 'reveal';
    g!.revealEndsAt = now + groupRevealMsOf(r.game);
  }

  /**
   * Public lobby: the clock starts once two players are in and stops if they drop below two;
   * when it runs out (or every seat is taken) the match starts.
   */
  private autoStart(now: number) {
    const s = this.state!;
    if (!s.public || s.phase !== 'lobby') return;
    const here = s.players.filter((p) => p.connected).length;
    if (here < GROUP_MIN_PLAYERS) {
      s.autoStartAt = null;
      return;
    }
    s.autoStartAt ??= now + QUICK_FILL_MS;
    if (now >= s.autoStartAt || s.players.length >= GROUP_MAX_PLAYERS) {
      // Seats of players who are away right now don't hold the match up.
      for (let i = s.players.length - 1; i >= 0; i--) if (!s.players[i].connected) s.players.splice(i, 1);
      s.autoStartAt = null;
      this.startMatch(now, this.votedGames());
    }
  }

  private toLobby() {
    const s = this.state!;
    s.phase = 'lobby';
    s.game = null;
    for (let i = s.players.length - 1; i >= 0; i--) if (!s.players[i].connected || s.players[i].left) s.players.splice(i, 1);
    if (!s.players.some((p) => p.connected)) s.emptySince ??= Date.now();
  }

  private removePlayer(seat: number) {
    const s = this.state!;
    s.players.splice(seat, 1);
    if (!s.players.some((p) => p.connected)) s.emptySince ??= Date.now();
  }

  async tick(now: number) {
    const s = this.state;
    if (!s) return;
    if (s.emptySince !== null && now >= s.emptySince + EMPTY_GROUP_TTL_MS) {
      await this.destroy();
      return;
    }
    const g = s.game;
    if (s.phase === 'countdown' && g?.countdownEndsAt && now >= g.countdownEndsAt) this.startRound(g.current + 1, now);
    if (s.phase === 'playing') this.settle(now);
    if (s.phase === 'reveal' && g?.revealEndsAt && now >= g.revealEndsAt) {
      const next = g.current + 1;
      if (next < g.roundGames.length && g.roundGames[next] === g.roundGames[g.current]) this.startRound(next, now);
      else {
        // A game is over: show how the ranking changed.
        s.phase = 'standings';
        g.revealEndsAt = null;
        g.standingsEndsAt = now + GROUP_STANDINGS_MS;
      }
    }
    if (s.phase === 'standings' && g?.standingsEndsAt && now >= g.standingsEndsAt) {
      g.standingsEndsAt = null;
      if (g.current + 1 >= g.roundGames.length) s.phase = 'finished';
      else {
        s.phase = 'countdown';
        g.countdownEndsAt = now + GROUP_STAGE_INTRO_MS;
      }
    }
    // Lobby seats of players who stayed away are freed; in a game they just stop being waited for.
    if (s.phase === 'lobby') {
      for (let i = s.players.length - 1; i >= 0; i--) {
        const p = s.players[i];
        if (!p.connected && p.disconnectedAt !== null && now >= p.disconnectedAt + RECONNECT_GRACE_MS) this.removePlayer(i);
      }
    }
    await this.commit(now);
  }

  private nextAlarmAt(): number | null {
    const s = this.state;
    if (!s) return null;
    const times: number[] = [];
    if (s.emptySince !== null) times.push(s.emptySince + EMPTY_GROUP_TTL_MS);
    const g = s.game;
    if (s.phase === 'countdown' && g?.countdownEndsAt) times.push(g.countdownEndsAt);
    if (s.phase === 'playing' && g?.rounds[g.current]) times.push(g.rounds[g.current].deadline);
    if (s.phase === 'reveal' && g?.revealEndsAt) times.push(g.revealEndsAt);
    if (s.phase === 'standings' && g?.standingsEndsAt) times.push(g.standingsEndsAt);
    if (s.phase === 'lobby' && s.autoStartAt) times.push(s.autoStartAt);
    if (s.phase === 'lobby')
      for (const p of s.players)
        if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + RECONNECT_GRACE_MS);
    return times.length ? Math.min(...times) : null;
  }

  private async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'room_closed');
    this.state = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- Persistence & broadcast ----------

  private async commit(now = Date.now()) {
    this.autoStart(now);
    await this.ctx.storage.put('state', this.state!);
    const at = this.nextAlarmAt();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
    this.broadcast();
  }

  private broadcast() {
    const room = this.view();
    const now = Date.now();
    const g = this.state!.game;
    const r = g && this.state!.phase === 'playing' ? g.rounds[g.current] : undefined;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.seatOf(ws);
      if (seat === null) continue;
      // Each player sees their own answer; everyone else's stays hidden until the reveal.
      const mine = r?.entries[seat] ? entryView(r, r.entries[seat]) : null;
      this.send(ws, { t: 'state', room: { ...room, mine }, you: seat, now });
    }
  }

  /** Standings after the games finished so far. */
  private standings(): StandingView[] {
    const s = this.state!;
    const g = s.game!;
    const n = s.players.length;
    const done = g.rounds.filter((r) => r.ended);
    const last = done.at(-1);
    const start = last ? stageSpan(g.roundGames, g.rounds.indexOf(last)).start : 0;
    const before = tallyOf(done.slice(0, start), n);
    const after = tallyOf(done, n);
    const prev = start > 0 ? ranksOf(before) : null;
    const ranks = ranksOf(after);
    return after
      .map((t, i) => ({ player: i, rank: ranks[i], prevRank: prev?.[i] ?? null, score: t.score, gained: t.score - before[i].score }))
      .sort((a, b) => a.rank - b.rank || a.player - b.player);
  }

  private view(): GroupView {
    const s = this.state!;
    const g = s.game;
    const n = s.players.length;
    const tally = tallyOf(g?.rounds ?? [], n);
    const counting = s.phase === 'countdown';
    const r = g && g.current >= 0 && !counting ? g.rounds[g.current] : undefined;
    const playing = s.phase === 'playing' && r;
    const mode = r && isModeId(r.game) ? r.game : null;
    const playable = g ? [] : playableGames(s.regions);
    // Rounds per game: the same for every game (rooms stored before that use the Flags count).
    const perGame = s.roundCounts.flags;

    // Stage info: during a countdown the game about to start; otherwise the current round's.
    const games = g?.roundGames ?? [];
    const at = g ? Math.min(counting ? g.current + 1 : Math.max(0, g.current), games.length - 1) : 0;
    const span = g ? stageSpan(games, at) : null;
    const stageScores = s.players.map((_, i) =>
      (g?.stages ?? []).flatMap((stage) => {
        const rounds = g!.rounds.filter((x) => x.ended && x.game === stage);
        const total = games.filter((x) => x === stage).length;
        return rounds.length === total && total > 0 ? [rounds.reduce((sum, x) => sum + (x.entries[i]?.points ?? 0), 0)] : [];
      }),
    );

    return {
      code: s.code,
      phase: s.phase,
      players: s.players.map((p, i) => ({
        name: p.name,
        connected: p.connected,
        left: !!p.left,
        score: tally[i].score,
        correct: tally[i].correct,
        timeMs: tally[i].timeMs,
        status: r && (s.phase === 'playing' || s.phase === 'reveal') && r.entries[i] ? statusOf(r, r.entries[i]) : null,
        misses:
          r && mode && MODES[mode].input === 'map' && (s.phase === 'playing' || s.phase === 'reveal')
            ? [...(r.entries[i]?.misses ?? [])]
            : null,
        votes: s.phase === 'lobby' ? (p.votes ?? []) : [],
      })),
      maxPlayers: GROUP_MAX_PLAYERS,
      public: !!s.public,
      autoStartAt: s.phase === 'lobby' ? (s.autoStartAt ?? null) : null,
      regions: s.regions,
      countryCount: countriesInRegions(s.regions).length,
      modes: g ? g.stages : playable,
      roundCounts: s.roundCounts,
      rounds: perGame,
      matchGames: MATCH_GAMES,
      shuffle: true,
      stage: g && span ? Math.max(0, g.stages.indexOf(games[at])) : 0,
      stageRound: g && span && !counting ? g.current - span.start + 1 : 0,
      stageRounds: span?.rounds ?? perGame,
      round: g ? g.current + 1 : 0,
      totalRounds: g ? games.length : Math.min(MATCH_GAMES, playable.length) * perGame,
      flag: playing && g!.tokens[g!.current] ? g!.tokens[g!.current] : null,
      prompt: playing && mode ? (MODES[mode].promptText?.(r.code) ?? null) : null,
      // The zoom point stays through the reveal, so the photo doesn't jump when the round ends.
      focus: r && mode && MODES[mode].prompt === 'photo' && s.phase !== 'standings' ? focusOf(r.code) : null,
      pair: (s.phase === 'playing' || s.phase === 'reveal') && r?.pair ? pairView(r.pair) : null,
      mine: null,
      countdownEndsAt: g?.countdownEndsAt ?? null,
      deadline: playing ? r.deadline : null,
      revealEndsAt: g?.revealEndsAt ?? null,
      standingsEndsAt: g?.standingsEndsAt ?? null,
      reveal:
        s.phase === 'reveal' && r
          ? {
              game: r.game,
              flag: g!.tokens[g!.current] || null,
              code: r.code,
              ...(mode ? itemInfo(mode, r.code) : { country: null, countryName: '', answer: '', detail: null }),
              pair: r.pair ? revealedPair(r.pair) : null,
              entries: r.entries.map((e) => entryView(r, e)),
            }
          : null,
      standings: g && (s.phase === 'standings' || s.phase === 'finished') ? this.standings() : null,
      stageScores,
    };
  }

  private seatOf(ws: WebSocket): number | null {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.state) return null;
    const i = this.state.players.findIndex((p) => p.sessionId === att.sessionId);
    return i >= 0 ? i : null;
  }

  private send(ws: WebSocket, msg: GroupServerMessage) {
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
