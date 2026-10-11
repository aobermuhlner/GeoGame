import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_BY_CODE,
  GROUP_MAX_PLAYERS,
  MATCH_GAMES,
  QUICK_FILL_MS,
  QUICK_ROUNDS,
  higherOf,
  type GameId,
  type GroupServerMessage,
  type RoundCounts,
} from '@flagduel/shared';
import type { GroupRoom, GroupState } from '../src/group';
import { BASE, Client, ORIGIN } from './helpers';

type State = Extract<GroupServerMessage, { t: 'state' }>;

async function createGroup(): Promise<string> {
  const res = await exports.default.fetch(new Request(`${BASE}/groups`, { method: 'POST', headers: { Origin: ORIGIN } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

async function joinGroup(code: string, name: string) {
  const res = await exports.default.fetch(
    new Request(`${BASE}/groups/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
  );
  expect(res.status).toBe(101);
  const c = new Client(res.webSocket!);
  const s = (await c.state({ t: 'hello', name, sessionId: `sess-${name}-${Math.random().toString(36).slice(2)}` }, (m) =>
    (m as unknown as State).room.players.some((p) => p.name === name),
  )) as unknown as State;
  return { c, you: s.you };
}

/** The latest snapshot if it already satisfies `pred` (it may have arrived before we started waiting), else the next that does. */
function waitState(c: Client, pred: (s: State) => boolean): Promise<State> {
  const last = c.messages.findLast((m) => m.t === 'state') as unknown as State | undefined;
  if (last && pred(last)) return Promise.resolve(last);
  return c.state(null, (m) => pred(m as unknown as State)) as unknown as Promise<State>;
}

const stub = (code: string) => env.GROUPS.getByName(code);
const internal = (code: string) => runInDurableObject(stub(code), (r: GroupRoom) => r.debugState()).then((s) => s!);
/** Start a match with these games in this order, as if the votes had picked them. */
const startWith = (code: string, games: GameId[], rounds: Partial<RoundCounts> = {}) =>
  runInDurableObject(stub(code), (room: GroupRoom) => room.debugStart(games, rounds));
async function tickAt(code: string, at: (st: GroupState) => number) {
  await runInDurableObject(stub(code), async (room: GroupRoom) => {
    const st = (await room.debugState())!;
    await room.tick(at(st));
  });
}

describe('group lobby', () => {
  it('offers every game at 5 rounds, plays 5 of them, and seats up to 8 players', async () => {
    const code = await createGroup();
    const info = await exports.default.fetch(new Request(`${BASE}/rooms/${code}`));
    expect(await info.json()).toMatchObject({ code, kind: 'group', phase: 'lobby' });

    const seats = [];
    for (let i = 0; i < GROUP_MAX_PLAYERS; i++) seats.push(await joinGroup(code, `P${i}`));
    expect(seats.map((s) => s.you)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const last = await waitState(seats[0].c, (s) => s.room.players.length === GROUP_MAX_PLAYERS);
    expect(last.room.modes).toEqual(['flags', 'capitals', 'locate', 'landmarks', 'languages', 'guess', 'higher']);
    expect(Object.values(last.room.roundCounts).every((n) => n === 5)).toBe(true);
    expect(last.room.matchGames).toBe(MATCH_GAMES);
    expect(last.room.totalRounds).toBe(MATCH_GAMES * 5);

    const res = await exports.default.fetch(
      new Request(`${BASE}/groups/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
    );
    const ninth = new Client(res.webSocket!);
    const err = ninth.next('error');
    ninth.send({ t: 'hello', name: 'Nine', sessionId: 'sess-nine-12345' });
    expect((await err).code).toBe('room_full');
  });

  it('needs two players and only lets the host start', async () => {
    const code = await createGroup();
    const host = await joinGroup(code, 'Host');
    const err = host.c.next('error');
    host.c.send({ t: 'start' });
    expect((await err).code).toBe('not_allowed');
    const guest = await joinGroup(code, 'Guest');
    const err2 = guest.c.next('error');
    guest.c.send({ t: 'start' });
    expect((await err2).code).toBe('not_allowed');
  });
});

describe('group chat', () => {
  type Chat = Extract<GroupServerMessage, { t: 'chat' }>;
  const chats = (c: Client) => (c.messages as unknown as GroupServerMessage[]).filter((m): m is Chat => m.t === 'chat');
  async function until<T>(f: () => T | undefined): Promise<T> {
    for (let i = 0; i < 200; i++) {
      const v = f();
      if (v !== undefined) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out');
  }

  it('sends lines to everyone, keeps the history for newcomers, and limits the pace', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    // Hello gets the (empty) history.
    expect((await until(() => chats(b.c).find((m) => m.reset))).lines).toEqual([]);

    a.c.send({ t: 'chat', text: '  hi   all  ' });
    const got = await until(() => chats(b.c).find((m) => !m.reset));
    expect(got.lines).toMatchObject([{ id: 1, seat: 0, name: 'Ann', text: 'hi all' }]);

    // Too quick after the last line.
    const err = a.c.next('error');
    a.c.send({ t: 'chat', text: 'again' });
    expect((await err).code).toBe('not_allowed');

    // Empty and overlong lines.
    const bad = b.c.next('error');
    b.c.send({ t: 'chat', text: '   ' });
    expect((await bad).code).toBe('bad_message');
    b.c.send({ t: 'chat', text: 'x'.repeat(500) });
    const long = await until(() => chats(a.c).find((m) => m.lines[0]?.seat === 1));
    expect(long.lines[0].text).toHaveLength(200);

    const c = await joinGroup(code, 'Cid');
    const history = await until(() => chats(c.c).find((m) => m.reset));
    expect(history.lines.map((l) => l.id)).toEqual([1, 2]);
  });
});

describe('group match', () => {
  it('plays rounds where everyone answers, shows standings after each game, and ends on the podium', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    const c = await joinGroup(code, 'Cid');
    await startWith(code, ['flags', 'higher'], { flags: 2, higher: 1 });
    const counting = await waitState(a.c, (s) => s.room.phase === 'countdown');
    expect(counting.room.totalRounds).toBe(3);

    for (let round = 1; round <= 2; round++) {
      await tickAt(code, (st) => st.game!.countdownEndsAt ?? st.game!.revealEndsAt!);
      const st = await internal(code);
      expect(st.phase).toBe('playing');
      const answer = COUNTRY_BY_CODE[st.game!.codes[round - 1]].name;
      const playing = await waitState(b.c, (s) => s.room.phase === 'playing' && s.room.round === round);
      expect(playing.room.flag).toBeTruthy();
      // Ann answers first (more points), Ben second, Cid passes.
      a.c.send({ t: 'guess', round, text: answer });
      await waitState(b.c, (s) => s.room.players[0].status === 'correct');
      b.c.send({ t: 'guess', round, text: 'Atlantis' });
      b.c.send({ t: 'guess', round, text: answer });
      await waitState(c.c, (s) => s.room.players[1].status === 'correct');
      const reveal = await c.c.state({ t: 'pass', round }, (s) => (s as unknown as State).room.phase === 'reveal');
      const r = (reveal as unknown as State).room.reveal!;
      expect(r.answer).toBe(answer);
      expect(r.entries[0].points).toBeGreaterThanOrEqual(r.entries[1].points);
      expect(r.entries[1].wrong).toBe(1);
      expect(r.entries[2]).toMatchObject({ end: 'passed', points: 0 });
    }

    // Flags is over: standings.
    await tickAt(code, (st) => st.game!.revealEndsAt!);
    const standings = await waitState(a.c, (s) => s.room.phase === 'standings');
    expect(standings.room.standings!.map((x) => x.player)).toEqual([0, 1, 2]);
    expect(standings.room.standings![0]).toMatchObject({ rank: 1, prevRank: null });
    expect(standings.room.stageScores[0]).toHaveLength(1);

    // Higher or Lower: everyone sees the same pair.
    await tickAt(code, (st) => st.game!.standingsEndsAt!);
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    const [pa, pc] = await Promise.all([
      waitState(a.c, (s) => s.room.phase === 'playing' && !!s.room.pair),
      waitState(c.c, (s) => s.room.phase === 'playing' && !!s.room.pair),
    ]);
    expect(pa.room.pair).toEqual(pc.room.pair);
    const st = await internal(code);
    const pair = st.game!.pairs[2]!;
    const right = higherOf(pair);
    const wrong = right === pair.a ? pair.b : pair.a;
    a.c.send({ t: 'pick', round: 3, code: wrong });
    b.c.send({ t: 'pick', round: 3, code: wrong });
    const rev = await c.c.state({ t: 'pick', round: 3, code: right }, (s) => (s as unknown as State).room.phase === 'reveal');
    expect((rev as unknown as State).room.reveal!.pair!.answer).toBe(right);

    await tickAt(code, (s) => s.game!.revealEndsAt!);
    const after = await waitState(a.c, (s) => s.room.phase === 'standings');
    const cid = after.room.standings!.find((x) => x.player === 2)!;
    expect(cid.prevRank).toBe(3);
    expect(cid.gained).toBeGreaterThan(0);

    await tickAt(code, (s) => s.game!.standingsEndsAt!);
    const done = await waitState(a.c, (s) => s.room.phase === 'finished');
    expect(done.room.standings).toHaveLength(3);
    expect(done.room.stageScores[2]).toHaveLength(2);

    const lobby = await a.c.state({ t: 'backToLobby' }, (s) => (s as unknown as State).room.phase === 'lobby');
    expect((lobby as unknown as State).room.players).toHaveLength(3);
  });

  it('plays the most voted games, in random order, and shows everyone the votes', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    const c = await joinGroup(code, 'Cid');
    a.c.send({ t: 'setAllRounds', rounds: 1 });
    // Five games get two votes each; Cid's lone vote for Higher or Lower loses.
    const five: GameId[] = ['flags', 'capitals', 'locate', 'languages', 'guess'];
    a.c.send({ t: 'vote', games: five });
    b.c.send({ t: 'vote', games: ['flags', 'capitals', 'locate', 'languages', 'guess'] });
    c.c.send({ t: 'vote', games: ['higher'] });
    const seen = await waitState(c.c, (s) => s.room.players.every((p) => p.votes.length > 0) && s.room.rounds === 1);
    expect(seen.room.players.map((p) => p.votes)).toEqual([five, five, ['higher']]);
    expect(seen.room.totalRounds).toBe(MATCH_GAMES);

    // More than MATCH_GAMES votes is malformed.
    const err = c.c.next('error');
    c.c.send({ t: 'vote', games: ['flags', 'capitals', 'locate', 'landmarks', 'languages', 'guess'] });
    expect((await err).code).toBe('bad_message');

    await a.c.state({ t: 'start' }, (s) => (s as unknown as State).room.phase === 'countdown');
    const st = await internal(code);
    expect([...st.game!.stages].sort()).toEqual([...five].sort());
    expect(st.game!.roundGames).toEqual(st.game!.stages);
    const counting = await waitState(a.c, (s) => s.room.phase === 'countdown');
    expect(counting.room.modes).toEqual(st.game!.stages);
    expect(counting.room.shuffle).toBe(true);
    expect(counting.room.stage).toBe(0);
    // Votes can't change mid-match.
    expect(counting.room.players.every((p) => p.votes.length === 0)).toBe(true);
  });

  it('fills up to five games at random when there are too few votes', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    await joinGroup(code, 'Ben');
    a.c.send({ t: 'vote', games: ['higher'] });
    await waitState(a.c, (s) => s.room.players[0].votes.length === 1);
    await a.c.state({ t: 'start' }, (s) => (s as unknown as State).room.phase === 'countdown');
    const st = await internal(code);
    expect(st.game!.stages).toHaveLength(MATCH_GAMES);
    expect(new Set(st.game!.stages).size).toBe(MATCH_GAMES);
    expect(st.game!.stages).toContain('higher');
  });

  it('stops waiting for a player who left', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    await startWith(code, ['flags']);
    await waitState(a.c, (s) => s.room.phase === 'countdown');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    await waitState(a.c, (s) => s.room.phase === 'playing');
    b.c.send({ t: 'leave' });
    await waitState(a.c, (s) => s.room.players[1].left);
    const st = await internal(code);
    const reveal = await a.c.state(
      { t: 'guess', round: 1, text: COUNTRY_BY_CODE[st.game!.codes[0]].name },
      (s) => (s as unknown as State).room.phase === 'reveal',
    );
    expect((reveal as unknown as State).room.reveal!.entries[0].end).toBe('correct');
  });
});

describe('public games ("Find a game")', () => {
  const quick = async () => {
    const res = await exports.default.fetch(new Request(`${BASE}/quick`, { method: 'POST', headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { code: string }).code;
  };

  it('puts searching players into one lobby that starts a minute after the second joins', async () => {
    const code = await quick();
    expect(await quick()).toBe(code); // nobody joined yet: still the same lobby
    const a = await joinGroup(code, 'Ann');
    let s = await waitState(a.c, (x) => x.room.players.length === 1);
    expect(s.room.public).toBe(true);
    expect(s.room.autoStartAt).toBeNull();
    expect(s.room.matchGames).toBe(MATCH_GAMES);
    expect(s.room.totalRounds).toBe(MATCH_GAMES * QUICK_ROUNDS);

    const b = await joinGroup(code, 'Ben');
    s = await waitState(a.c, (x) => x.room.players.length === 2 && x.room.autoStartAt !== null);
    expect(s.room.autoStartAt! - s.now).toBeGreaterThan(QUICK_FILL_MS - 2_000);

    // Nobody hosts: settings and "start" are refused.
    const err = a.c.next('error');
    a.c.send({ t: 'start' });
    expect((await err).code).toBe('not_allowed');
    const err2 = a.c.next('error');
    a.c.send({ t: 'setAllRounds', rounds: 2 });
    expect((await err2).code).toBe('not_allowed');
    // ...but everyone votes.
    a.c.send({ t: 'vote', games: ['flags', 'capitals', 'locate', 'landmarks', 'higher'] });
    b.c.send({ t: 'vote', games: ['flags', 'capitals', 'locate', 'landmarks', 'higher'] });
    await waitState(b.c, (x) => x.room.players.every((p) => p.votes.length === 5));
    expect((await internal(code)).phase).toBe('lobby');

    // A third player still gets in while the clock runs.
    expect(await quick()).toBe(code);
    await joinGroup(code, 'Cat');
    await waitState(a.c, (x) => x.room.players.length === 3);

    await tickAt(code, (st) => st.autoStartAt!);
    const started = await internal(code);
    expect(started.phase).toBe('countdown');
    expect([...started.game!.stages].sort()).toEqual(['capitals', 'flags', 'higher', 'landmarks', 'locate']);
    await waitState(b.c, (x) => x.room.phase === 'countdown');

    // That lobby is playing: the next search opens a new one.
    const next = await quick();
    expect(next).not.toBe(code);
  });

  it('stops the clock when it drops back to one player', async () => {
    const code = await quick();
    const a = await joinGroup(code, 'Dan');
    const b = await joinGroup(code, 'Eve');
    await waitState(a.c, (x) => x.room.players.length >= 2 && x.room.autoStartAt !== null);
    b.c.send({ t: 'leave' });
    const s = await waitState(a.c, (x) => !x.room.players.some((p) => p.name === 'Eve'));
    expect(s.room.autoStartAt).toBeNull();
    a.c.send({ t: 'leave' });
    while ((await internal(code)).players.length) await new Promise((r) => setTimeout(r, 10));
  });
});
