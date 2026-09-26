import { describe, expect, it } from 'vitest';
import { CAPITAL_BY_CODE, COUNTRY_BY_CODE, RECONNECT_GRACE_MS } from '@flagduel/shared';
import { createRoom, internal, join, tickAt } from './helpers';

/** Two players in a started match, sitting on round 1. */
async function startedMatch() {
  const code = await createRoom();
  const host = await join(code, 'Adrian');
  const guest = await join(code, 'Anna');
  await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
  await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
  await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
  const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
  await tickAt(code, (st) => st.game!.countdownEndsAt!);
  await playing;
  return { code, host, guest };
}

const answerOf = async (code: string) => {
  const st = await internal(code);
  return COUNTRY_BY_CODE[st.game!.codes[st.game!.current]].name;
};

/** From a reveal, move on to the next round. */
async function nextRound(code: string, c: Awaited<ReturnType<typeof join>>['c'], round: number) {
  const p = c.state(null, (s) => s.room.phase === 'playing' && s.room.round === round);
  await tickAt(code, (st) => st.game!.revealEndsAt!);
  return p;
}

describe('rounds', () => {
  it('first correct guess wins the point and ends the round for both', async () => {
    const { code, host, guest } = await startedMatch();
    const answer = await answerOf(code);

    const oppWrong = host.c.next('oppWrong');
    const wrong = guest.c.next('guessResult');
    guest.c.send({ t: 'guess', round: 1, text: 'Atlantis' });
    expect((await wrong).outcome).toBe('wrong');
    expect((await oppWrong).round).toBe(1); // opponent sees activity, not the text

    const revealG = guest.c.state(null, (s) => s.room.phase === 'reveal');
    const ok = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: answer.toUpperCase() });
    expect((await ok).outcome).toBe('correct');
    const r = (await revealG).room;
    expect(r.reveal).toMatchObject({ countryName: answer, winner: 0, wrong: [0, 1], end: 'correct' });
    expect(r.players[0].score).toBe(1);
    expect(r.players[1].wrongTotal).toBe(1);

    // A late correct guess from the guest is ignored.
    const late = guest.c.next('guessResult');
    guest.c.send({ t: 'guess', round: 1, text: answer });
    expect((await late).outcome).toBe('ignored');
    expect((await internal(code)).game!.rounds[0].winner).toBe(0);
  });

  it('two correct guesses back to back: arrival order decides', async () => {
    const { code, host, guest } = await startedMatch();
    const answer = await answerOf(code);
    const a = guest.c.next('guessResult');
    const b = host.c.next('guessResult');
    guest.c.send({ t: 'guess', round: 1, text: answer });
    host.c.send({ t: 'guess', round: 1, text: answer });
    const outcomes = [(await a).outcome, (await b).outcome].sort();
    expect(outcomes).toEqual(['correct', 'ignored']);
    const st = await internal(code);
    expect(st.game!.rounds[0].winner).toBe((await a).outcome === 'correct' ? 1 : 0);
  });

  it('guesses for another round are ignored', async () => {
    const { code, host } = await startedMatch();
    const answer = await answerOf(code);
    const r = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 2, text: answer });
    expect((await r).outcome).toBe('ignored');
    expect((await internal(code)).phase).toBe('playing');
  });

  it('both pass → no point; a passed player cannot guess', async () => {
    const { code, host, guest } = await startedMatch();
    const answer = await answerOf(code);
    await host.c.state({ t: 'pass', round: 1 }, (s) => s.room.players[0].passed);
    const r = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: answer });
    expect((await r).outcome).toBe('ignored');

    const reveal = await guest.c.state({ t: 'pass', round: 1 }, (s) => s.room.phase === 'reveal');
    expect(reveal.room.reveal).toMatchObject({ winner: null, end: 'passed' });
    expect(reveal.room.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('timeout → no point, then the next flag appears for both after the reveal', async () => {
    const { code, host, guest } = await startedMatch();
    const reveal = guest.c.state(null, (s) => s.room.phase === 'reveal');
    await tickAt(code, (st) => st.game!.rounds[0].deadline);
    expect((await reveal).room.reveal).toMatchObject({ winner: null, end: 'timeout' });
    const firstFlag = (await internal(code)).game!.tokens[0];

    const [h, g] = await Promise.all([nextRound(code, host.c, 2), guest.c.state(null, (s) => s.room.round === 2)]);
    expect(h.room.flag).toBe(g.room.flag);
    expect(h.room.flag).not.toBe(firstFlag);
    expect(h.room.history).toHaveLength(1);
  });
});

describe('match end', () => {
  it('10 rounds → results with winner, tie-breaker data and per-round history', async () => {
    const { code, host, guest } = await startedMatch();
    for (let round = 1; round <= 10; round++) {
      const answer = await answerOf(code);
      // Guest makes one wrong guess every round; host and guest alternate points.
      await guest.c.state({ t: 'guess', round, text: 'Atlantis' }, (s) => s.room.players[1].wrongTotal === round);
      const who = round % 2 === 1 ? host : guest;
      await who.c.state({ t: 'guess', round, text: answer }, (s) => s.room.phase === 'reveal');
      if (round < 10) await nextRound(code, host.c, round + 1);
    }
    const done = host.c.state(null, (s) => s.room.phase === 'finished');
    await tickAt(code, (st) => st.game!.revealEndsAt!);
    const r = (await done).room;
    expect(r.result).toEqual({ winner: 0, scores: [5, 5], wrongTotals: [0, 10], decidedBy: 'tiebreaker' });
    expect(r.history).toHaveLength(10);
    expect(r.history.every((h) => h.wrong[1] === 1)).toBe(true);
  });

  it('give up forfeits the whole match', async () => {
    const { host, guest } = await startedMatch();
    const done = host.c.state(null, (s) => s.room.phase === 'finished');
    guest.c.send({ t: 'giveUp' });
    const r = (await done).room;
    expect(r.result).toMatchObject({ winner: 0, decidedBy: 'forfeit' });
    expect(r.forfeitReason).toBe('gaveUp');
    expect(r.history.at(-1)?.end).toBe('forfeit');
  });

  it('rematch needs both players and keeps the regions', async () => {
    const { code, host, guest } = await startedMatch();
    await host.c.state({ t: 'giveUp' }, (s) => s.room.phase === 'finished');
    const one = await host.c.state({ t: 'rematch' }, (s) => s.room.players[0].rematch);
    expect(one.room.phase).toBe('finished');
    const again = await guest.c.state({ t: 'rematch' }, (s) => s.room.phase === 'countdown');
    expect(again.room.regions).toHaveLength(8);
    expect(again.room.history).toEqual([]);
    expect((await internal(code)).game!.forfeitedBy).toBeNull();
  });

  it('back to lobby resets ready state', async () => {
    const { host, guest } = await startedMatch();
    await host.c.state({ t: 'giveUp' }, (s) => s.room.phase === 'finished');
    const lobby = await guest.c.state({ t: 'backToLobby' }, (s) => s.room.phase === 'lobby');
    expect(lobby.room.players.map((p) => p.ready)).toEqual([false, false]);
    expect(lobby.room.players).toHaveLength(2);
  });
});

describe('disconnects', () => {
  it('a player gone for 20 s mid-game loses; the other wins', async () => {
    const { code, host, guest } = await startedMatch();
    const away = host.c.state(null, (s) => s.room.players[1].connected === false);
    guest.c.ws.close();
    const s = (await away).room;
    expect(s.players[1].graceEndsAt).not.toBeNull();

    // 1 ms before the grace ends: still playing.
    await tickAt(code, (st) => st.players[1].disconnectedAt! + RECONNECT_GRACE_MS - 1);
    expect((await internal(code)).phase).toBe('playing');

    const done = host.c.state(null, (s) => s.room.phase === 'finished');
    await tickAt(code, (st) => st.players[1].disconnectedAt! + RECONNECT_GRACE_MS);
    const r = (await done).room;
    expect(r.result).toMatchObject({ winner: 0, decidedBy: 'forfeit' });
    expect(r.forfeitReason).toBe('disconnected');
  });

  it('reconnecting within the grace period keeps the match going', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian', 'sess-host-bbbbbbbb');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
    host.c.ws.close();
    await guest.c.state(null, (s) => !s.room.players[0].connected);
    const back = await join(code, 'Adrian', 'sess-host-bbbbbbbb');
    expect(back.you).toBe(0);
    await tickAt(code, (st) => Math.max(st.game!.countdownEndsAt!, Date.now() + RECONNECT_GRACE_MS));
    expect((await internal(code)).phase).toBe('playing');
  });

  it('leaving mid-game forfeits and the seat cannot be reclaimed', async () => {
    const { code, host, guest } = await startedMatch();
    const done = host.c.state(null, (s) => s.room.phase === 'finished');
    guest.c.send({ t: 'leave' });
    expect((await done).room.forfeitReason).toBe('left');
    const st = await internal(code);
    expect(st.players[1].left).toBe(true);
    const err = host.c.next('error');
    host.c.send({ t: 'rematch' });
    expect((await err).message).toMatch(/left/);
  });
});

describe('multi-game matches', () => {
  it('only the host picks the games; flags then capitals with a stage countdown in between', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    const denied = guest.c.next('error');
    guest.c.send({ t: 'setModes', modes: ['capitals'] });
    expect((await denied).code).toBe('not_allowed');

    const lobby = await host.c.state({ t: 'setModes', modes: ['capitals', 'flags'] }, (s) => s.room.modes.length === 2);
    expect(lobby.room.modes).toEqual(['flags', 'capitals']);
    expect(lobby.room.totalRounds).toBe(20);

    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
    const first = guest.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    const r1 = (await first).room;
    expect(r1).toMatchObject({ stage: 0, stageRound: 1, stageRounds: 10, prompt: null, totalRounds: 20 });

    for (let round = 1; round <= 20; round++) {
      const st = await internal(code);
      const i = st.game!.current;
      const mode = st.game!.roundModes![i];
      expect(mode).toBe(round <= 10 ? 'flags' : 'capitals');
      const country = COUNTRY_BY_CODE[st.game!.codes[i]].name;
      const answer = mode === 'flags' ? country : CAPITAL_BY_CODE[st.game!.codes[i]].name;
      // Host scores every flag; guest scores every capital.
      const who = mode === 'flags' ? host : guest;
      const rev = await who.c.state({ t: 'guess', round, text: answer }, (s) => s.room.phase === 'reveal');
      expect(rev.room.reveal).toMatchObject({ mode, countryName: country, answer });
      if (round === 10) {
        const intro = host.c.state(null, (s) => s.room.phase === 'countdown');
        await tickAt(code, (st) => st.game!.revealEndsAt!);
        const ir = (await intro).room;
        expect(ir).toMatchObject({ stage: 1, stageRound: 0, flag: null });
        const cap = guest.c.state(null, (s) => s.room.phase === 'playing' && s.room.round === 11);
        await tickAt(code, (st) => st.game!.countdownEndsAt!);
        const cr = (await cap).room;
        expect(cr).toMatchObject({ stage: 1, stageRound: 1, prompt: COUNTRY_BY_CODE[(await internal(code)).game!.codes[10]].name });
      } else if (round < 20) {
        await nextRound(code, host.c, round + 1);
      }
    }
    const done = host.c.state(null, (s) => s.room.phase === 'finished');
    await tickAt(code, (st) => st.game!.revealEndsAt!);
    const r = (await done).room;
    expect(r.result).toMatchObject({ winner: null, scores: [10, 10], decidedBy: 'draw' });
    expect(r.history.map((h) => h.mode)).toEqual([...Array(10).fill('flags'), ...Array(10).fill('capitals')]);
  });

  it('GeoLocate: clicks are ISO codes, 3 misses each ends the round with no point', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'setModes', modes: ['locate'] }, (s) => s.room.modes[0] === 'locate');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
    const first = guest.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    const target = (await internal(code)).game!.codes[0];
    expect((await first).room.prompt).toBe(COUNTRY_BY_CODE[target].name);

    const miss = target === 'FR' ? 'DE' : 'FR';
    for (let i = 0; i < 3; i++) {
      const res = host.c.next('guessResult');
      host.c.send({ t: 'guess', round: 1, text: miss });
      expect((await res).outcome).toBe('wrong');
    }
    const out = await host.c.state(null, (s) => s.room.players[0].passed);
    expect(out.room.phase).toBe('playing');
    const late = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: target });
    expect((await late).outcome).toBe('ignored');

    for (let i = 0; i < 2; i++) guest.c.send({ t: 'guess', round: 1, text: miss });
    const rev = await guest.c.state({ t: 'guess', round: 1, text: miss }, (s) => s.room.phase === 'reveal');
    expect(rev.room.reveal).toMatchObject({ mode: 'locate', code: target, winner: null, end: 'passed', wrong: [3, 3] });

    // Round 2: a correct click scores.
    await nextRound(code, host.c, 2);
    const t2 = (await internal(code)).game!.codes[1];
    const win = await guest.c.state({ t: 'guess', round: 2, text: t2 }, (s) => s.room.phase === 'reveal');
    expect(win.room.reveal).toMatchObject({ code: t2, winner: 1, end: 'correct' });
  });
});
