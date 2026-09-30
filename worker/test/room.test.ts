import { exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Room } from '../src/room';
import { BASE, Client, ORIGIN, createRoom, join, stub } from './helpers';

describe('HTTP routes', () => {
  it('creates rooms with unambiguous 5-char codes', async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it('rejects unknown origins', async () => {
    const res = await exports.default.fetch(
      new Request(`${BASE}/rooms`, { method: 'POST', headers: { Origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(403);
  });

  it('answers CORS preflight', async () => {
    const res = await exports.default.fetch(new Request(`${BASE}/rooms`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('404s the WebSocket of a room that was never created', async () => {
    const res = await exports.default.fetch(
      new Request(`${BASE}/rooms/ZZZZZ/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
    );
    expect(res.status).toBe(404);
  });

  it('404s malformed or unknown flag tokens', async () => {
    const code = await createRoom();
    for (const t of ['de', `${code}0123456789abcdef`, '../etc']) {
      const res = await exports.default.fetch(new Request(`${BASE}/flags/${t}`));
      expect(res.status).toBe(404);
    }
  });
});

describe('lobby', () => {
  it('seats host and guest, rejects a third player', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    expect(host.you).toBe(0);
    expect(guest.you).toBe(1);

    const third = await Client.connect(code);
    const err = third.next('error');
    third.send({ t: 'hello', name: 'Eve', sessionId: 'sess-eve-12345' });
    expect((await err).code).toBe('room_full');
  });

  it('rejects malformed messages', async () => {
    const code = await createRoom();
    const c = await Client.connect(code);
    const err = c.next('error');
    c.ws.send('{"t":"hello","name":"","sessionId":"x"}');
    expect((await err).code).toBe('bad_message');
  });

  it('only the host changes regions; guest sees them live', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');

    const seen = guest.c.state(null, (s) => s.room.regions.length === 2);
    host.c.send({ t: 'setRegions', regions: ['oceania', 'europe'] });
    const s = await seen;
    expect(s.room.regions).toEqual(['europe', 'oceania']); // canonical order
    expect(s.room.countryCount).toBe(46 + 14);

    const err = guest.c.next('error');
    guest.c.send({ t: 'setRegions', regions: ['asia'] });
    expect((await err).code).toBe('not_allowed');
  });

  it('start requires both ready and a big enough pool, then counts down and serves the first flag', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');

    let err = host.c.next('error');
    host.c.send({ t: 'start' });
    expect((await err).message).toMatch(/ready/);

    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);

    await host.c.state({ t: 'setRegions', regions: ['north-america'] }, (s) => s.room.countryCount === 3);
    err = host.c.next('error');
    host.c.send({ t: 'start' });
    expect((await err).code).toBe('pool_too_small');

    await host.c.state({ t: 'setRegions', regions: ['europe'] }, (s) => s.room.countryCount === 46);
    const started = guest.c.state(null, (s) => s.room.phase === 'countdown');
    host.c.send({ t: 'start' });
    expect((await started).room.phase).toBe('countdown');
  });
});

describe('game start', () => {
  it('countdown → round 1 with a tokenised flag that reveals nothing', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);

    const countdown = await guest.c.state(null, (s) => s.room.phase === 'countdown').catch(() => null);
    expect(countdown).toBeNull(); // guest cannot start
    const cd = host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');
    const s1 = await cd;
    expect(s1.room.countdownEndsAt! - s1.now).toBeGreaterThan(2500);
    expect(s1.room.flag).toBeNull();

    // Fire the countdown alarm without waiting 3 s.
    const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
    await runInDurableObject(stub(code), async (room: Room) => {
      const st = await room.debugState();
      await room.tick(st!.game!.countdownEndsAt!);
    });
    const s2 = await playing;
    expect(s2.room.round).toBe(1);
    expect(s2.room.totalRounds).toBe(10);
    expect(s2.room.flag).toMatch(new RegExp(`^${code}[0-9a-f]{16}$`));
    // The snapshot never contains the answer.
    const internal = await runInDurableObject(stub(code), (room: Room) => room.debugState());
    const answer = internal!.game!.codes[0];
    const json = JSON.stringify(s2);
    expect(json).not.toContain(`"${answer}"`);

    const res = await exports.default.fetch(new Request(`${BASE}/flags/${s2.room.flag}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await res.text()).toMatch(/^<svg/);

    // Flags of rounds that have not started yet are not served.
    const future = internal!.game!.tokens[1];
    expect((await exports.default.fetch(new Request(`${BASE}/flags/${future}`))).status).toBe(404);
  });
});

describe('connections', () => {
  it('a reconnect with the same session keeps the seat', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian', 'sess-host-aaaaaaaa');
    await join(code, 'Anna');
    host.c.ws.close();
    const again = await join(code, 'Adrian', 'sess-host-aaaaaaaa');
    expect(again.you).toBe(0);
    const st = await runInDurableObject(stub(code), (room: Room) => room.debugState());
    expect(st!.players).toHaveLength(2);
    expect(st!.players[0].connected).toBe(true);
  });

  it('a guest who leaves the lobby is removed after the grace period', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    const gone = host.c.state(null, (s) => s.room.players[1]?.connected === false);
    guest.c.ws.close();
    await gone;

    const removed = host.c.state(null, (s) => s.room.players.length === 1);
    await runInDurableObject(stub(code), async (room: Room) => {
      const st = await room.debugState();
      await room.tick(st!.players[1].disconnectedAt! + 20_000);
    });
    await removed;
  });

  it('an empty room deletes its storage after 10 minutes', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    host.c.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    await runInDurableObject(stub(code), async (room: Room) => {
      const st = await room.debugState();
      expect(st!.emptySince).not.toBeNull();
      await room.tick(st!.emptySince! + 10 * 60_000);
    });
    const after = await runInDurableObject(stub(code), async (room: Room, state) => ({
      st: await room.debugState(),
      stored: await state.storage.get('state'),
    }));
    expect(after.st).toBeNull();
    expect(after.stored).toBeUndefined();
    // The alarm path works too (nothing left to do).
    expect(await runDurableObjectAlarm(stub(code))).toBe(false);
  });
});

describe('room info', () => {
  it('GET /rooms/:code reports existence and player count', async () => {
    const code = await createRoom();
    await join(code, 'Adrian');
    const res = await exports.default.fetch(new Request(`${BASE}/rooms/${code.toLowerCase()}`, { headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code, kind: 'duel', phase: 'lobby', players: 1 });
    expect((await exports.default.fetch(new Request(`${BASE}/rooms/AAAAA`))).status).toBe(404);
  });
});

describe('leaving', () => {
  it('host leaving the lobby promotes the guest to host', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    const promoted = guest.c.state(null, (s) => s.room.players.length === 1);
    host.c.send({ t: 'leave' });
    const s = await promoted;
    expect(s.you).toBe(0);
    expect(s.room.players[0].name).toBe('Anna');
  });
});

describe('lock-in games (Landmarks)', () => {
  it('needs enough landmarks in the regions', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'setModes', modes: ['landmarks'] }, (s) => s.room.modes[0] === 'landmarks');
    await host.c.state({ t: 'setRegions', regions: ['caribbean'] }, (s) => s.room.regions.length === 1);
    const err = host.c.next('error');
    host.c.send({ t: 'start' });
    expect((await err).message).toMatch(/Landmarks needs regions with at least 10 landmarks/);
  });

  it('hides answers until both are in, then reveals both with points; the photo comes via its token', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'setModes', modes: ['landmarks'] }, (s) => s.room.modes[0] === 'landmarks');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');

    const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
    await runInDurableObject(stub(code), async (room: Room) => {
      await room.tick((await room.debugState())!.game!.countdownEndsAt!);
    });
    const s1 = await playing;
    expect(s1.room.focus).toHaveLength(2);
    const internal = await runInDurableObject(stub(code), (room: Room) => room.debugState());
    const id = internal!.game!.codes[0];
    expect(JSON.stringify(s1)).not.toContain(id);

    const photo = await exports.default.fetch(new Request(`${BASE}/flags/${s1.room.flag}`));
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg');

    const { LANDMARK_BY_ID, LANDMARK_META, COUNTRY_BY_CODE, formatPin } = await import('@flagduel/shared');
    const { lat, lon } = LANDMARK_META[id];
    const pin = formatPin({ lat: lat!, lon: lon!, km: 100 });

    // Text that is no pin is refused; a pin locks in.
    const bad = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: 'France' });
    expect((await bad).outcome).toBe('invalid');
    const seenLock = guest.c.state(null, (s) => s.room.players[0].locked);
    const ok = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: pin });
    expect((await ok).outcome).toBe('locked');
    const g = await seenLock;
    expect(g.room.myLock).toBeNull(); // the guest never sees the host's answer
    expect(JSON.stringify(g)).not.toContain(pin);

    const reveal = guest.c.state(null, (s) => s.room.phase === 'reveal');
    guest.c.send({ t: 'pass', round: 1 });
    const r = (await reveal).room.reveal!;
    expect(r.locks).toEqual([{ answer: pin, correct: true, accuracy: null }, null]);
    expect(r.points).toEqual([6, 0]); // smallest circle 5, first right +1
    expect(r.answer).toBe(LANDMARK_BY_ID[id].name);
    expect(r.detail).toBe(COUNTRY_BY_CODE[LANDMARK_BY_ID[id].country].name);
    expect(r.end).toBe('locked');
  });

  it('GeoGuesser: 30 s rounds, estimates stay hidden, the closer one scores', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'setModes', modes: ['guess'] }, (s) => s.room.modes[0] === 'guess');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');

    const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
    let startedAt = 0;
    await runInDurableObject(stub(code), async (room: Room) => {
      startedAt = (await room.debugState())!.game!.countdownEndsAt!;
      await room.tick(startedAt);
    });
    const s1 = await playing;
    const id = (await runInDurableObject(stub(code), (room: Room) => room.debugState()))!.game!.codes[0];
    const { GUESS_BY_ID, GUESS_TIME_MS, parseGuessPrompt } = await import('@flagduel/shared');
    const q = GUESS_BY_ID[id];
    expect(parseGuessPrompt(s1.room.prompt!)).toEqual({ quantity: q.quantity, text: q.text });
    expect(JSON.stringify(s1)).not.toContain(id);
    expect(s1.room.deadline! - startedAt).toBeGreaterThanOrEqual(GUESS_TIME_MS - 50);

    const bad = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: 'a lot' });
    expect((await bad).outcome).toBe('invalid');
    const exact = String(q.answer);
    const seenLock = guest.c.state(null, (s) => s.room.players[0].locked);
    host.c.send({ t: 'guess', round: 1, text: exact });
    const g = await seenLock;
    expect(g.room.myLock).toBeNull();

    const reveal = guest.c.state(null, (s) => s.room.phase === 'reveal');
    guest.c.send({ t: 'guess', round: 1, text: String(q.answer * 3 + 1000) });
    const r = (await reveal).room.reveal!;
    expect(r.code).toBe(id);
    expect(r.locks![0]).toMatchObject({ answer: exact, correct: true, accuracy: 1 });
    expect(r.locks![1]!.correct).toBe(false);
    expect(r.points).toEqual([2, 0]);
  });

  it('moves on to the reveal once both players have locked in', async () => {
    const code = await createRoom();
    const host = await join(code, 'Adrian');
    const guest = await join(code, 'Anna');
    await host.c.state({ t: 'setModes', modes: ['landmarks'] }, (s) => s.room.modes[0] === 'landmarks');
    await host.c.state({ t: 'ready', ready: true }, (s) => s.room.players[0].ready);
    await guest.c.state({ t: 'ready', ready: true }, (s) => s.room.players[1].ready);
    await host.c.state({ t: 'start' }, (s) => s.room.phase === 'countdown');

    const playing = guest.c.state(null, (s) => s.room.phase === 'playing');
    await runInDurableObject(stub(code), async (room: Room) => {
      await room.tick((await room.debugState())!.game!.countdownEndsAt!);
    });
    await playing;
    const id = (await runInDurableObject(stub(code), (room: Room) => room.debugState()))!.game!.codes[0];
    const { LANDMARK_META, formatPin } = await import('@flagduel/shared');
    const { lat, lon } = LANDMARK_META[id];
    const right = formatPin({ lat: lat!, lon: lon!, km: 500 });
    const wrong = formatPin({ lat: -lat!, lon: lon! > 0 ? lon! - 180 : lon! + 180, km: 2000 }); // the antipode

    const hostLocked = host.c.next('guessResult');
    host.c.send({ t: 'guess', round: 1, text: wrong });
    expect((await hostLocked).outcome).toBe('locked');
    const reveal = host.c.state(null, (s) => s.room.phase === 'reveal');
    const guestLocked = guest.c.next('guessResult');
    guest.c.send({ t: 'guess', round: 1, text: right });
    expect((await guestLocked).outcome).toBe('locked');
    const r = (await reveal).room.reveal!;
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([0, 4]); // 500 km circle 3, first right +1
  });
});
