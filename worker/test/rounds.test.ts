import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_COUNTS, higherOf, parseClientMessage, type GameId, type HigherPair } from '@flagduel/shared';
import { createRoom, internal, join, tickAt } from './helpers';

type Player = Awaited<ReturnType<typeof join>>;

async function lobby() {
  const code = await createRoom();
  const host = await join(code, 'Host');
  const guest = await join(code, 'Guest');
  return { code, host, guest };
}

/** Pick the games and their rounds, get ready and start: resolves on the first round. */
async function start(code: string, host: Player, guest: Player, rounds: Partial<Record<GameId, number>>) {
  const modes = Object.keys(rounds) as GameId[];
  await host.c.state({ t: 'setModes', modes }, (s) => s.room.modes.length === modes.length);
  for (const [game, n] of Object.entries(rounds) as [GameId, number][])
    await host.c.state({ t: 'setRounds', game, rounds: n }, (s) => s.room.roundCounts[game] === n);
  await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
  await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
  await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
  const playing = host.c.state(null, (s) => s.room.phase === 'playing');
  await tickAt(code, (st) => st.game!.countdownEndsAt!);
  return playing;
}

const wrongOf = (p: HigherPair) => (higherOf(p) === p.a ? p.b : p.a);

/** Both pick in the current Higher or Lower round; resolves with the snapshot after its reveal. */
async function pickRound(
  code: string,
  host: Player,
  guest: Player,
  round: number,
  hostRight: boolean,
  guestRight: boolean,
) {
  const st = await internal(code);
  const pair = st.game!.duel!.rounds.at(-1)!.pair;
  await host.c.state(
    { t: 'pick', round, code: hostRight ? higherOf(pair) : wrongOf(pair) },
    (s) => s.room.higher!.picked[0],
  );
  await guest.c.state(
    { t: 'pick', round, code: guestRight ? higherOf(pair) : wrongOf(pair) },
    (s) => s.room.phase === 'reveal',
  );
  const next = host.c.state(null, (s) => s.room.phase !== 'reveal');
  await tickAt(code, (x) => x.game!.revealEndsAt!);
  return (await next).room;
}

/** Both pass the current minigame round; resolves with the snapshot after its reveal. */
async function passRound(code: string, host: Player, guest: Player, round: number) {
  await host.c.state({ t: 'pass', round }, (s) => s.room.players[0].passed);
  await guest.c.state({ t: 'pass', round }, (s) => s.room.phase === 'reveal');
  const next = host.c.state(null, (s) => s.room.phase !== 'reveal');
  await tickAt(code, (x) => x.game!.revealEndsAt!);
  return (await next).room;
}

describe('picking games and rounds', () => {
  it('only accepts 1–20 rounds for a known game, and any mix of games', () => {
    const msg = (m: object) => parseClientMessage(JSON.stringify(m));
    expect(msg({ t: 'setRounds', game: 'flags', rounds: 1 })).toEqual({ t: 'setRounds', game: 'flags', rounds: 1 });
    expect(msg({ t: 'setRounds', game: 'higher', rounds: 20 })).toEqual({ t: 'setRounds', game: 'higher', rounds: 20 });
    expect(msg({ t: 'setRounds', game: 'flags', rounds: 0 })).toBeNull();
    expect(msg({ t: 'setRounds', game: 'flags', rounds: 21 })).toBeNull();
    expect(msg({ t: 'setRounds', game: 'flags', rounds: 2.5 })).toBeNull();
    expect(msg({ t: 'setRounds', game: 'chess', rounds: 5 })).toBeNull();
    // Games are played in a fixed order, whatever order they were sent in
    expect(msg({ t: 'setModes', modes: ['higher', 'languages', 'flags'] })).toEqual({
      t: 'setModes',
      modes: ['flags', 'languages', 'higher'],
    });
  });

  it('host sets rounds per game; the match plays exactly that many', async () => {
    const { code, host, guest } = await lobby();
    const first = await host.c.state({ t: 'ready', ready: false }, () => true);
    expect(first.room.roundCounts).toEqual(DEFAULT_ROUND_COUNTS);

    const err = guest.c.next('error');
    guest.c.send({ t: 'setRounds', game: 'flags', rounds: 3 });
    expect((await err).code).toBe('not_allowed');

    const playing = await start(code, host, guest, { flags: 3, capitals: 5 });
    expect(playing.room).toMatchObject({ totalRounds: 8, stageRounds: 3, modes: ['flags', 'capitals'] });
    expect((await internal(code)).game!.roundModes).toEqual([...Array(3).fill('flags'), ...Array(5).fill('capitals')]);
  });

  it('Higher or Lower alone uses the chosen number of regular rounds', async () => {
    const { code, host, guest } = await lobby();
    const playing = await start(code, host, guest, { higher: 1 });
    expect(playing.room.higher).toMatchObject({ round: 1, regularRounds: 1, tiebreak: false });
    const room = await pickRound(code, host, guest, 1, true, false);
    expect(room.result).toMatchObject({ winner: 0, scores: [1, 0], decidedBy: 'points' });
  });
});

describe('mixed matches', () => {
  it('plays minigames and Higher or Lower in one match; points add up', async () => {
    const { code, host, guest } = await lobby();
    const playing = await start(code, host, guest, { languages: 2, higher: 2 });
    expect(playing.room).toMatchObject({ modes: ['languages', 'higher'], stage: 0, round: 1, totalRounds: 4 });
    expect(playing.room.prompt).toBeTruthy(); // the sentence

    await passRound(code, host, guest, 1);
    let room = await passRound(code, host, guest, 2);
    // "Next up: Higher or Lower"
    expect(room).toMatchObject({ phase: 'countdown', stage: 1 });
    const hl = host.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    room = (await hl).room;
    expect(room).toMatchObject({ round: 3, stage: 1, flag: null });
    expect(room.higher).toMatchObject({ round: 1, regularRounds: 2 });
    expect(room.higher!.pair).not.toBeNull();

    await pickRound(code, host, guest, 3, true, true);
    room = await pickRound(code, host, guest, 4, true, false);
    expect(room.phase).toBe('finished');
    expect(room.result).toMatchObject({ winner: 0, scores: [2, 1], decidedBy: 'points' });
    expect(room.history).toHaveLength(2);
    expect(room.higher!.history).toHaveLength(2);
  });

  it('a tie over all games goes to Higher or Lower sudden death', async () => {
    const { code, host, guest } = await lobby();
    await start(code, host, guest, { languages: 1, higher: 1 });
    await passRound(code, host, guest, 1);
    const next = host.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    await next;
    // 1 : 1 → sudden death announcement, then more Higher or Lower
    let room = await pickRound(code, host, guest, 2, true, true);
    expect(room).toMatchObject({ phase: 'countdown', stage: 1 });
    expect(room.higher).toMatchObject({ tiebreak: true });
    const sd = host.c.state(null, (s) => s.room.phase === 'playing');
    await tickAt(code, (st) => st.game!.countdownEndsAt!);
    expect((await sd).room).toMatchObject({ round: 3, stage: 1, totalRounds: 3 });
    room = await pickRound(code, host, guest, 3, false, true);
    expect(room.result).toMatchObject({ winner: 1, scores: [1, 2], decidedBy: 'tiebreaker' });
  });

  it('without Higher or Lower a tie is still decided by wrong answers', async () => {
    const { code, host, guest } = await lobby();
    await start(code, host, guest, { languages: 1 });
    const room = await passRound(code, host, guest, 1);
    expect(room.result).toMatchObject({ winner: null, decidedBy: 'draw' });
  });
});
