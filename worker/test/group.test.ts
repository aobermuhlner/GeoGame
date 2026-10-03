import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_BY_CODE,
  GROUP_MAX_PLAYERS,
  QUICK_FILL_MS,
  QUICK_GAMES,
  QUICK_ROUNDS,
  higherOf,
  type GroupServerMessage,
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
async function tickAt(code: string, at: (st: GroupState) => number) {
  await runInDurableObject(stub(code), async (room: GroupRoom) => {
    const st = (await room.debugState())!;
    await room.tick(at(st));
  });
}

describe('group lobby', () => {
  it('starts with every game at 5 rounds and seats up to 8 players', async () => {
    const code = await createGroup();
    const info = await exports.default.fetch(new Request(`${BASE}/rooms/${code}`));
    expect(await info.json()).toMatchObject({ code, kind: 'group', phase: 'lobby' });

    const seats = [];
    for (let i = 0; i < GROUP_MAX_PLAYERS; i++) seats.push(await joinGroup(code, `P${i}`));
    expect(seats.map((s) => s.you)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const last = await waitState(seats[0].c, (s) => s.room.players.length === GROUP_MAX_PLAYERS);
    expect(last.room.modes).toEqual(['flags', 'capitals', 'locate', 'landmarks', 'languages', 'guess', 'higher']);
    expect(Object.values(last.room.roundCounts).every((n) => n === 5)).toBe(true);
    expect(last.room.totalRounds).toBe(35);

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

describe('group match', () => {
  it('plays rounds where everyone answers, shows standings after each game, and ends on the podium', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    const c = await joinGroup(code, 'Cid');
    a.c.send({ t: 'setModes', modes: ['flags', 'higher'] });
    a.c.send({ t: 'setRounds', game: 'flags', rounds: 2 });
    await waitState(a.c, (s) => s.room.roundCounts.flags === 2 && s.room.modes.length === 2);
    a.c.send({ t: 'setRounds', game: 'higher', rounds: 1 });
    await waitState(a.c, (s) => s.room.roundCounts.higher === 1);

    const counting = await a.c.state({ t: 'start' }, (s) => (s as unknown as State).room.phase === 'countdown');
    expect((counting as unknown as State).room.totalRounds).toBe(3);

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

  it('random order: games are shuffled when the match starts', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    await joinGroup(code, 'Ben');
    for (const game of ['flags', 'capitals', 'locate', 'landmarks', 'languages', 'guess', 'higher'] as const)
      a.c.send({ t: 'setRounds', game, rounds: 1 });
    a.c.send({ t: 'setShuffle', shuffle: true });
    await waitState(a.c, (s) => s.room.shuffle && s.room.totalRounds === 7);
    await a.c.state({ t: 'start' }, (s) => (s as unknown as State).room.phase === 'countdown');
    const st = await internal(code);
    expect([...st.game!.stages].sort()).toEqual([...st.modes].sort());
    expect(st.game!.roundGames).toEqual(st.game!.stages);
    const counting = await waitState(a.c, (s) => s.room.phase === 'countdown');
    expect(counting.room.modes).toEqual(st.game!.stages);
    expect(counting.room.stage).toBe(0);
  });

  it('stops waiting for a player who left', async () => {
    const code = await createGroup();
    const a = await joinGroup(code, 'Ann');
    const b = await joinGroup(code, 'Ben');
    a.c.send({ t: 'setModes', modes: ['flags'] });
    await waitState(a.c, (s) => s.room.modes.length === 1);
    await a.c.state({ t: 'start' }, (s) => (s as unknown as State).room.phase === 'countdown');
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
    expect(s.room.modes).toHaveLength(QUICK_GAMES);
    expect(s.room.totalRounds).toBe(QUICK_GAMES * QUICK_ROUNDS);

    const b = await joinGroup(code, 'Ben');
    s = await waitState(a.c, (x) => x.room.players.length === 2 && x.room.autoStartAt !== null);
    expect(s.room.autoStartAt! - s.now).toBeGreaterThan(QUICK_FILL_MS - 2_000);

    // Nobody hosts: settings and "start" are refused.
    const err = a.c.next('error');
    a.c.send({ t: 'start' });
    expect((await err).code).toBe('not_allowed');
    const err2 = a.c.next('error');
    a.c.send({ t: 'setModes', modes: ['flags'] });
    expect((await err2).code).toBe('not_allowed');
    expect((await internal(code)).phase).toBe('lobby');

    // A third player still gets in while the clock runs.
    expect(await quick()).toBe(code);
    await joinGroup(code, 'Cat');
    await waitState(a.c, (x) => x.room.players.length === 3);

    await tickAt(code, (st) => st.autoStartAt!);
    expect((await internal(code)).phase).toBe('countdown');
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
  });
});
