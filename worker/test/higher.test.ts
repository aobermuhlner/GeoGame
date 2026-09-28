import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  DUEL_ROUNDS,
  HIGHER_ROUNDS,
  HIGHER_TIME_MS,
  dayOf,
  higherOf,
  type HigherBoardResponse,
  type HigherPair,
  type HigherResponse,
  type LoginResponse,
  type MeResponse,
} from '@flagduel/shared';
import { BASE, ORIGIN, createRoom, internal, join, tickAt } from './helpers';

const db = () => env.ACCOUNTS.getByName('main');

function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function devLogin(name: string): Promise<LoginResponse> {
  const res = await call('/auth/dev', { method: 'POST', body: { name } });
  expect(res.status).toBe(200);
  return res.json();
}

const wrongOf = (p: HigherPair) => (higherOf(p) === p.a ? p.b : p.a);

/** Play today's whole run: mistakes at the given (1-based) questions, `ms` per answer. */
async function playRun(userId: string, t0: number, wrongAt: number[], ms = 1000) {
  let now = t0 + COUNTDOWN_MS;
  await db().higherStart(userId, t0);
  let run = (await db().higherGet(userId, now))!.run;
  for (let round = 1; round <= run.totalRounds; round++) {
    if (round > 1) run = (await db().higherNext(userId, round - 1, now))!.run;
    const pair = run.pair!;
    const p: HigherPair = { stat: pair.stat, a: pair.a, b: pair.b };
    now += ms;
    run = (await db().higherPick(userId, round, wrongAt.includes(round) ? wrongOf(p) : higherOf(p), now))!.run;
  }
  return run;
}

describe('daily Higher or Lower', () => {
  it('everyone gets the same category and pairs; values stay hidden until answered', async () => {
    const a = await devLogin('HlA');
    const b = await devLogin('HlB');
    const t0 = Date.now();
    const sa = (await (await call('/higher/daily/start', { method: 'POST', token: a.token })).json()) as HigherResponse;
    const sb = (await (await call('/higher/daily/start', { method: 'POST', token: b.token })).json()) as HigherResponse;
    expect(sa.run).toMatchObject({
      phase: 'countdown',
      round: 1,
      totalRounds: HIGHER_ROUNDS,
      pair: null,
      date: dayOf(t0),
    });
    expect(sa.run.stat).toBe(sb.run.stat);

    const ua = (await db().authenticate(a.token))!;
    const ub = (await db().authenticate(b.token))!;
    const later = Date.now() + COUNTDOWN_MS + 100;
    const pa = (await db().higherGet(ua.id, later))!.run;
    const pb = (await db().higherGet(ub.id, later))!.run;
    expect(pa.phase).toBe('playing');
    expect(pa.pair).toEqual(pb.pair);
    expect(JSON.stringify(pa)).not.toContain('values');

    // HTTP validation
    expect((await call('/higher/daily/pick', { method: 'POST', token: a.token, body: { round: 1 } })).status).toBe(400);
    expect(
      (await call('/higher/daily/pick', { method: 'POST', token: a.token, body: { round: 1, code: 'de' } })).status,
    ).toBe(400);
    expect((await call('/higher/daily')).status).toBe(401);
    const c = await devLogin('HlC');
    expect((await call('/higher/daily', { token: c.token })).status).toBe(404); // not started
  });

  it('a run continues after mistakes; the ranking puts the longest flawless start first', async () => {
    const t0 = Date.now();
    const players = [
      ['HlEarly', [3]], // 2 flawless, 14 correct
      ['HlLate2', [10, 11]], // 9 flawless, 13 correct
      ['HlLate1', [13]], // 12 flawless
      ['HlSlow', [13]], // 12 flawless, same correct, slower
    ] as const;
    let token = '';
    for (const [name, wrongAt] of players) {
      const login = await devLogin(name);
      if (name === 'HlLate2') token = login.token;
      const run = await playRun(login.user.id, t0, [...wrongAt], name === 'HlSlow' ? 2000 : 1000);
      expect(run.phase).toBe('finished');
      expect(run.history).toHaveLength(HIGHER_ROUNDS);
      expect(run.correct).toBe(HIGHER_ROUNDS - wrongAt.length);
    }
    const board = (await (await call('/higher/leaderboard', { token })).json()) as HigherBoardResponse;
    const mine = board.entries.filter((e) => e.name.startsWith('Hl'));
    expect(mine.map((e) => [e.name, e.flawless, e.correct])).toEqual([
      ['HlLate1', 12, 14],
      ['HlSlow', 12, 14],
      ['HlLate2', 9, 13],
      ['HlEarly', 2, 14],
    ]);
    expect(mine[0].rank).toBeLessThan(mine[1].rank);
    expect(board.you).toMatchObject({ name: 'HlLate2', flawless: 9, you: true });

    // Summary and stats
    const summary = (await (await call('/daily', { token })).json()) as { higher: unknown };
    expect(summary.higher).toMatchObject({ status: 'finished', flawless: 9, correct: 13, rank: expect.any(Number) });
    const me = (await (await call('/me', { token })).json()) as MeResponse;
    expect(me.stats.higher).toEqual({ played: 1, bestFlawless: 9, perfect: 0 });
    expect(me.stats.daysPlayed).toBe(1);
  });

  it('a timeout counts as a mistake', async () => {
    const { user } = await devLogin('HlSleepy');
    const t0 = Date.now();
    await db().higherStart(user.id, t0);
    const v = (await db().higherGet(user.id, t0 + COUNTDOWN_MS + HIGHER_TIME_MS + 1))!.run;
    expect(v.reveal).toMatchObject({ end: 'timeout', pick: null });
    expect(v.flawless).toBe(0);
  });
});

/** Two players in a started Higher or Lower duel, sitting on round 1. */
async function startedDuel(regions?: string[]) {
  const code = await createRoom();
  const host = await join(code, 'Adrian');
  const guest = await join(code, 'Anna');
  await host.c.state({ t: 'setModes', modes: ['higher'] }, (s) => s.room.modes[0] === 'higher');
  if (regions)
    await host.c.state({ t: 'setRegions', regions: regions as never }, (s) => s.room.regions.length === regions.length);
  await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
  await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
  await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
  const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
  await tickAt(code, (st) => st.game!.countdownEndsAt!);
  await playing;
  return { code, host, guest };
}

const pairOf = async (code: string) => {
  const st = await internal(code);
  return st.game!.duel!.rounds[st.game!.current].pair;
};

describe('Higher or Lower duel', () => {
  it('guest cannot change the game; the lobby shows the pick', async () => {
    const code = await createRoom();
    const host = await join(code, 'Host');
    const guest = await join(code, 'Guest');
    const err = guest.c.next('error');
    guest.c.send({ t: 'setModes', modes: ['higher'] });
    expect((await err).code).toBe('not_allowed');
    const s = await host.c.state({ t: 'setModes', modes: ['higher'] }, (x) => x.room.modes[0] === 'higher');
    expect(s.room).toMatchObject({ modes: ['higher'], totalRounds: DUEL_ROUNDS, higher: null });
  });

  it('both answer; picks stay secret until both are in; each correct pick scores', async () => {
    const { code, host, guest } = await startedDuel();
    const pair = await pairOf(code);
    const right = higherOf(pair);

    const seen = guest.c.state(null, (s) => s.room.higher!.picked[0]);
    const mine = host.c.state({ t: 'pick', round: 1, code: right }, (s) => s.room.higher!.picked[0]);
    expect((await mine).room.higher).toMatchObject({ mine: right, picked: [true, false] });
    const g = (await seen).room;
    expect(g.higher).toMatchObject({ mine: null, picked: [true, false], reveal: null });
    expect(g.phase).toBe('playing');
    expect(JSON.stringify(g.higher)).not.toContain(`"${right}","${right}"`);

    // A second pick is ignored
    host.c.send({ t: 'pick', round: 1, code: wrongOf(pair) });
    const reveal = await guest.c.state({ t: 'pick', round: 1, code: wrongOf(pair) }, (s) => s.room.phase === 'reveal');
    expect(reveal.room.higher!.reveal).toMatchObject({
      picks: [right, wrongOf(pair)],
      correct: [true, false],
      answer: right,
    });
    expect(reveal.room.players.map((p) => p.score)).toEqual([1, 0]);
    expect(reveal.room.players.map((p) => p.wrongTotal)).toEqual([0, 1]);
  });

  it('a player who does not answer in 10 s misses the round', async () => {
    const { code, host } = await startedDuel();
    const pair = await pairOf(code);
    await host.c.state({ t: 'pick', round: 1, code: higherOf(pair) }, (s) => s.room.higher!.picked[0]);
    const reveal = host.c.state(null, (s) => s.room.phase === 'reveal');
    await tickAt(code, (st) => st.game!.duel!.rounds[0].deadline);
    const r = (await reveal).room;
    expect(r.higher!.reveal).toMatchObject({ end: 'timeout', picks: [higherOf(pair), null], correct: [true, false] });
  });

  it('plays all 10 rounds even when decided early, and categories change every round', async () => {
    const { code, host, guest } = await startedDuel();
    const stats = new Set<string>();
    for (let round = 1; round <= DUEL_ROUNDS; round++) {
      expect((await internal(code)).phase).toBe('playing');
      const pair = await pairOf(code);
      stats.add(pair.stat);
      await host.c.state({ t: 'pick', round, code: higherOf(pair) }, (s) => s.room.higher!.picked[0]);
      await guest.c.state({ t: 'pick', round, code: wrongOf(pair) }, (s) => s.room.phase === 'reveal');
      const next = host.c.state(null, (s) => s.room.phase !== 'reveal');
      await tickAt(code, (st) => st.game!.revealEndsAt!);
      await next;
    }
    expect(stats.size).toBe(DUEL_ROUNDS);
    const st = await internal(code);
    expect(st.phase).toBe('finished');
    expect(st.game!.result).toMatchObject({ winner: 0, scores: [10, 0], decidedBy: 'points' });
    expect(st.game!.duel!.rounds[0].deadline - st.game!.duel!.rounds[0].startedAt).toBe(20_000);
  });

  it('a tie after 10 rounds goes to sudden death', async () => {
    const { code, host, guest } = await startedDuel(['europe']);
    const play = async (round: number, hostRight: boolean, guestRight: boolean) => {
      const pair = await pairOf(code);
      expect((await internal(code)).game!.duel!.pool.every((c) => c !== 'US')).toBe(true); // regions apply
      await host.c.state(
        { t: 'pick', round, code: hostRight ? higherOf(pair) : wrongOf(pair) },
        (s) => s.room.higher!.picked[0],
      );
      await guest.c.state(
        { t: 'pick', round, code: guestRight ? higherOf(pair) : wrongOf(pair) },
        (s) => s.room.phase === 'reveal',
      );
      const next = host.c.state(null, (s) => s.room.phase !== 'reveal');
      await tickAt(code, (st) => st.game!.revealEndsAt!);
      return (await next).room;
    };
    for (let round = 1; round < DUEL_ROUNDS; round++) await play(round, true, true);
    // Tied after the last regular round: a "Sudden death" countdown before round 11.
    let room = await play(DUEL_ROUNDS, true, true);
    expect(room).toMatchObject({ phase: 'countdown' });
    expect(room.higher).toMatchObject({ tiebreak: true, pair: null });
    const sd = host.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    expect((await sd).room.round).toBe(DUEL_ROUNDS + 1);
    room = await play(DUEL_ROUNDS + 1, false, false);
    expect(room).toMatchObject({ phase: 'playing', round: DUEL_ROUNDS + 2 });
    expect(room.higher!.tiebreak).toBe(true);
    room = await play(DUEL_ROUNDS + 2, false, true);
    expect(room.phase).toBe('finished');
    expect(room.result).toMatchObject({ winner: 1, scores: [10, 11], decidedBy: 'tiebreaker' });
    expect(room.higher!.history).toHaveLength(DUEL_ROUNDS + 2);

    // Rematch plays Higher or Lower again
    await host.c.state({ t: 'rematch' }, (s) => s.room.players[0].rematch);
    const again = await guest.c.state({ t: 'rematch' }, (s) => s.room.phase === 'countdown');
    expect(again.room.modes).toEqual(['higher']);
    expect(again.room.higher!.history).toHaveLength(0);
  });

  it('flag guesses are ignored in a duel, and giving up forfeits', async () => {
    const { code, host } = await startedDuel();
    const r = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: 'France' });
    expect((await r).outcome).toBe('ignored');
    const done = await host.c.state({ t: 'giveUp' }, (s) => s.room.phase === 'finished');
    expect(done.room.result).toMatchObject({ winner: 1, decidedBy: 'forfeit' });
  });
});
