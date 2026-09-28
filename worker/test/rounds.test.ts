import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_COUNTS, higherOf, parseClientMessage } from '@flagduel/shared';
import { createRoom, internal, join, tickAt } from './helpers';

async function lobby() {
  const code = await createRoom();
  const host = await join(code, 'Host');
  const guest = await join(code, 'Guest');
  return { code, host, guest };
}

async function start(code: string, host: Awaited<ReturnType<typeof join>>, guest: Awaited<ReturnType<typeof join>>) {
  await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
  await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
  await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
  const playing = host.c.state(null, (s) => s.room.phase === 'playing');
  await tickAt(code, (st) => st.game!.countdownEndsAt!);
  return playing;
}

describe('rounds per game', () => {
  it('only accepts 1–20 rounds for a known game', () => {
    const msg = (game: unknown, rounds: unknown) =>
      parseClientMessage(JSON.stringify({ t: 'setRounds', game, rounds }));
    expect(msg('flags', 1)).toEqual({ t: 'setRounds', game: 'flags', rounds: 1 });
    expect(msg('higher', 20)).toEqual({ t: 'setRounds', game: 'higher', rounds: 20 });
    expect(msg('flags', 0)).toBeNull();
    expect(msg('flags', 21)).toBeNull();
    expect(msg('flags', 2.5)).toBeNull();
    expect(msg('chess', 5)).toBeNull();
  });

  it('host sets rounds per minigame; the match plays exactly that many', async () => {
    const { code, host, guest } = await lobby();
    const first = await host.c.state({ t: 'ready', ready: false }, () => true);
    expect(first.room.roundCounts).toEqual(DEFAULT_ROUND_COUNTS);

    const err = guest.c.next('error');
    guest.c.send({ t: 'setRounds', game: 'flags', rounds: 3 });
    expect((await err).code).toBe('not_allowed');

    await host.c.state({ t: 'setModes', modes: ['flags', 'capitals'] }, (s) => s.room.modes.length === 2);
    await host.c.state({ t: 'setRounds', game: 'flags', rounds: 3 }, (s) => s.room.roundCounts.flags === 3);
    const s = await host.c.state(
      { t: 'setRounds', game: 'capitals', rounds: 5 },
      (x) => x.room.roundCounts.capitals === 5,
    );
    expect(s.room.totalRounds).toBe(8);

    const playing = await start(code, host, guest);
    expect(playing.room).toMatchObject({ totalRounds: 8, stageRounds: 3 });
    expect((await internal(code)).game!.roundModes).toEqual([...Array(3).fill('flags'), ...Array(5).fill('capitals')]);
  });

  it('Higher or Lower duel uses the chosen number of regular rounds', async () => {
    const { code, host, guest } = await lobby();
    await host.c.state({ t: 'setKind', kind: 'higher' }, (s) => s.room.kind === 'higher');
    const s = await host.c.state({ t: 'setRounds', game: 'higher', rounds: 1 }, (x) => x.room.roundCounts.higher === 1);
    expect(s.room.totalRounds).toBe(1);

    const playing = await start(code, host, guest);
    expect(playing.room.higher).toMatchObject({ round: 1, regularRounds: 1, tiebreak: false });

    // Host right, guest wrong → decided after the single round.
    const pair = (await internal(code)).game!.duel!.rounds[0].pair;
    const right = higherOf(pair);
    await host.c.state({ t: 'pick', round: 1, code: right }, (x) => x.room.higher!.picked[0]);
    await guest.c.state(
      { t: 'pick', round: 1, code: right === pair.a ? pair.b : pair.a },
      (x) => x.room.phase === 'reveal',
    );
    const done = host.c.state(null, (x) => x.room.phase === 'finished');
    await tickAt(code, (st) => st.game!.revealEndsAt!);
    expect((await done).room.result).toMatchObject({ winner: 0, scores: [1, 0], decidedBy: 'points' });
  });
});
