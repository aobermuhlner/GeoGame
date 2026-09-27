import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  COUNTRY_BY_CODE,
  DIVISIONS,
  PLACEMENT_ROUNDS,
  RECONNECT_GRACE_MS,
  ROUND_TIME_MS,
  placementRating,
  type DailyRun,
  type LoginResponse,
  type ModeId,
  type QueueServerMessage,
  type RankedBoardResponse,
  type RankedProfile,
} from '@flagduel/shared';
import type { Accounts } from '../src/accounts';
import { BASE, Client, ORIGIN, internal, tickAt } from './helpers';

async function login(name: string): Promise<LoginResponse> {
  const res = await exports.default.fetch(
    new Request(`${BASE}/auth/dev`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

const post = (path: string, token: string, body?: unknown) =>
  exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );

const get = <T>(path: string, token?: string) =>
  exports.default
    .fetch(new Request(`${BASE}${path}`, { headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }))
    .then((r) => r.json() as Promise<T>);

/** A socket on the ranked queue. */
class Queue {
  messages: QueueServerMessage[] = [];
  closed: number | null = null;
  private waiters: ((m: QueueServerMessage) => void)[] = [];

  constructor(private ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as QueueServerMessage;
      this.messages.push(m);
      this.waiters.splice(0).forEach((w) => w(m));
    });
    ws.addEventListener('close', (e) => {
      this.closed = e.code;
    });
  }

  static async open(token: string, mode: ModeId): Promise<Queue> {
    const res = await exports.default.fetch(new Request(`${BASE}/ranked/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }));
    expect(res.status).toBe(101);
    const q = new Queue(res.webSocket!);
    q.ws.send(JSON.stringify({ t: 'queue', token, mode }));
    return q;
  }

  async next<T extends QueueServerMessage['t']>(t: T): Promise<Extract<QueueServerMessage, { t: T }>> {
    const have = this.messages.find((m) => m.t === t);
    if (have) return have as Extract<QueueServerMessage, { t: T }>;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), 3000);
      const wait = (m: QueueServerMessage) => {
        if (m.t === t) {
          clearTimeout(timer);
          resolve(m as Extract<QueueServerMessage, { t: T }>);
        } else this.waiters.push(wait);
      };
      this.waiters.push(wait);
    });
  }

  close() {
    this.ws.close(1000);
  }
}

async function seat(code: string, ticket: string, name: string) {
  const c = await Client.connect(code);
  const s = await c.state({ t: 'hello', name, sessionId: ticket });
  return { c, you: s.you };
}

/** Two fresh accounts matched in `mode`. */
async function matched(mode: ModeId = 'flags') {
  const tag = Math.random().toString(36).slice(2, 7);
  const [a, b] = await Promise.all([login(`A${tag}`), login(`B${tag}`)]);
  await Promise.all([post(`/ranked/${mode}/beginner`, a.token), post(`/ranked/${mode}/beginner`, b.token)]);
  const qa = await Queue.open(a.token, mode);
  await qa.next('queued');
  const qb = await Queue.open(b.token, mode);
  const [ma, mb] = await Promise.all([qa.next('matched'), qb.next('matched')]);
  return { a, b, ma, mb };
}

describe('ranked queue', () => {
  it('rejects a bad session', async () => {
    const q = await Queue.open('f'.repeat(64), 'flags');
    expect((await q.next('error')).message).toMatch(/sign in/i);
  });

  it('pairs two players into a ranked room in their division', async () => {
    const { a, b, ma, mb } = await matched('capitals');
    expect(ma.code).toBe(mb.code);
    expect(ma.ticket).not.toBe(mb.ticket);
    expect(ma.opponent.name).toBe(b.user.displayName);
    expect(mb.opponent).toMatchObject({ name: a.user.displayName, rating: 1000, division: 'bronze' });

    const st = await internal(ma.code);
    expect(st.ranked?.mode).toBe('capitals');
    expect(st.modes).toEqual(['capitals']);
    expect(st.pool).toEqual(DIVISIONS.bronze.countries);
  });

  it('keeps different minigames apart', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const [a, b] = await Promise.all([login(`F${tag}`), login(`G${tag}`)]);
    await Promise.all([post('/ranked/flags/beginner', a.token), post('/ranked/locate/beginner', b.token)]);
    const qa = await Queue.open(a.token, 'flags');
    const qb = await Queue.open(b.token, 'locate');
    await Promise.all([qa.next('queued'), qb.next('queued')]);
    await new Promise((r) => setTimeout(r, 200));
    expect(qa.messages.some((m) => m.t === 'matched')).toBe(false);
    qa.close();
    qb.close();
  });
});

describe('ranked unlock', () => {
  const db = () => env.ACCOUNTS.getByName('main');
  const fresh = () => login(`U${Math.random().toString(36).slice(2, 8)}`);

  /** The stored placement run (its codes are secret to the client until each round ends). */
  const storedRun = (userId: string, mode: ModeId) =>
    runInDurableObject(db(), (_: Accounts, state) => {
      const row = state.storage.sql
        .exec<{ state: string }>('SELECT state FROM placement_runs WHERE user_id = ? AND mode = ?', userId, mode)
        .toArray()[0];
      return row ? (JSON.parse(row.state) as DailyRun) : null;
    });

  it('a new player is locked out of the queue until they pick a start', async () => {
    const a = await fresh();
    const p = await get<RankedProfile>('/ranked', a.token);
    expect(p.flags).toMatchObject({ locked: true, placing: false });
    const q = await Queue.open(a.token, 'flags');
    expect((await q.next('error')).message).toMatch(/unlock/i);
  });

  it('beginner starts at 1000 in Bronze, per minigame, and rules out the test', async () => {
    const a = await fresh();
    const res = await post('/ranked/flags/beginner', a.token);
    expect(res.status).toBe(200);
    const p = (await res.json()) as RankedProfile;
    expect(p.flags).toMatchObject({ locked: false, rating: 1000, division: 'bronze', played: 0 });
    expect(p.capitals.locked).toBe(true);
    expect((await post('/ranked/flags/placement/start', a.token)).status).toBe(409);
    // Not on the ladder before a first match.
    const board = await get<RankedBoardResponse>('/ranked/leaderboard?mode=flags', a.token);
    expect(board.you).toBeNull();
  });

  it('the placement test sets the first rating from the share of correct answers, once', async () => {
    const a = await fresh();
    let t = Date.now();
    const start = await db().placementStart(a.user.id, 'flags', t);
    expect(start!.run.totalRounds).toBe(PLACEMENT_ROUNDS);
    expect((await get<RankedProfile>('/ranked', a.token)).flags).toMatchObject({ locked: true, placing: true });

    const codes = (await storedRun(a.user.id, 'flags'))!.codes;
    const right = 22; // 73% → 1350, Silver
    t += COUNTDOWN_MS + 1000;
    let last = start!;
    for (let round = 1; round <= codes.length; round++) {
      if (round <= right) {
        const g = await db().placementGuess(a.user.id, 'flags', round, COUNTRY_BY_CODE[codes[round - 1]].name, t);
        expect(g!.outcome).toBe('correct');
        last = g!;
      } else if (round % 2) {
        last = (await db().placementPass(a.user.id, 'flags', round, t))!;
      } else {
        t += ROUND_TIME_MS + 1; // let this one time out
        last = (await db().placementGet(a.user.id, 'flags', t))!;
      }
      t += 10;
      if (round < codes.length) await db().placementNext(a.user.id, 'flags', round, t);
      t += 10;
    }
    expect(last.run.phase).toBe('finished');
    expect(last.placement).toMatchObject({ correct: right, total: PLACEMENT_ROUNDS, rating: placementRating(right, PLACEMENT_ROUNDS) });
    expect(last.placement!.division).toBe('silver');

    const p = await get<RankedProfile>('/ranked', a.token);
    expect(p.flags).toMatchObject({ locked: false, rating: 1350, division: 'silver', played: 0, wins: 0, provisional: true });

    // No retake: starting again shows the finished test, guesses do nothing, the rating stays.
    const again = await post('/ranked/flags/placement/start', a.token);
    expect(((await again.json()) as { run: { phase: string } }).run.phase).toBe('finished');
    const late = await post('/ranked/flags/placement/guess', a.token, { round: PLACEMENT_ROUNDS, text: 'France' });
    expect(((await late.json()) as { outcome: string }).outcome).toBe('ignored');
    expect((await get<RankedProfile>('/ranked', a.token)).flags.rating).toBe(1350);
  });

  it('choosing beginner mid-test abandons the test', async () => {
    const a = await fresh();
    expect((await post('/ranked/capitals/placement/start', a.token)).status).toBe(200);
    const p = (await (await post('/ranked/capitals/beginner', a.token)).json()) as RankedProfile;
    expect(p.capitals).toMatchObject({ locked: false, rating: 1000, placing: false });
    expect((await post('/ranked/capitals/placement/pass', a.token, { round: 1 })).status).toBe(404);
  });
});

describe('ranked room', () => {
  it('starts when both seats are claimed, rates the result once', async () => {
    const { a, b, ma, mb } = await matched('flags');
    const pa = await seat(ma.code, ma.ticket, 'whatever');
    const pbState = Client.connect(mb.code).then(async (c) => {
      const s = await c.state({ t: 'hello', name: 'x', sessionId: mb.ticket }, (s) => s.room.phase === 'countdown');
      return { c, s };
    });
    const { c: cb, s } = await pbState;
    // Names come from the accounts, not from hello.
    expect(s.room.players.map((p) => p.name).sort()).toEqual([a.user.displayName, b.user.displayName].sort());
    expect(s.room.ranked).toMatchObject({ mode: 'flags', division: 'bronze' });
    expect(s.room.countryCount).toBe(DIVISIONS.bronze.countries.length);
    // Rounds come from the division's countries only.
    const codes = (await internal(ma.code)).game!.codes;
    expect(codes.every((c) => DIVISIONS.bronze.countries.includes(c))).toBe(true);

    // No lobby controls in ranked.
    const err = cb.next('error');
    cb.send({ t: 'setRegions', regions: ['asia'] });
    expect((await err).code).toBe('not_allowed');

    // B gives up → A wins; both get their rating change.
    const done = pa.c.state(null, (x) => x.room.phase === 'finished' && x.room.ranked?.players[0].delta != null);
    cb.send({ t: 'giveUp' });
    const fin = (await done).room;
    const winner = fin.result!.winner!;
    expect(fin.ranked!.players[winner].delta).toBeGreaterThan(0);
    expect(fin.ranked!.players[winner === 0 ? 1 : 0].delta).toBeLessThan(0);

    const pa2 = await get<RankedProfile>('/ranked', a.token);
    const pb2 = await get<RankedProfile>('/ranked', b.token);
    const winnerProfile = fin.players[winner].name === a.user.displayName ? pa2 : pb2;
    expect(winnerProfile.flags).toMatchObject({ played: 1, wins: 1, provisional: true });
    expect(winnerProfile.capitals.played).toBe(0);

    // Rating the same match again changes nothing.
    const st = await internal(ma.code);
    const again = await runInDurableObject(env.ACCOUNTS.getByName('main'), (db: Accounts) =>
      db.rankedResult(st.ranked!.matchId, 'flags', [st.ranked!.players[0].userId, st.ranked!.players[1].userId], 1),
    );
    expect(again).toEqual(st.ranked!.outcome);
    expect((await get<RankedProfile>('/ranked', a.token)).flags.played).toBe(1);

    const board = await get<RankedBoardResponse>('/ranked/leaderboard?mode=flags', a.token);
    expect(board.you?.name).toBe(a.user.displayName);
    expect(board.entries.length).toBeGreaterThanOrEqual(2);

    // Rematch is for friend lobbies only.
    const err2 = pa.c.next('error');
    pa.c.send({ t: 'rematch' });
    expect((await err2).code).toBe('not_allowed');
  });

  it('a stranger cannot take a ranked seat', async () => {
    const { ma } = await matched();
    const c = await Client.connect(ma.code);
    const err = c.next('error');
    c.send({ t: 'hello', name: 'Eve', sessionId: 'sess-eve-12345678' });
    expect((await err).code).toBe('room_full');
  });

  it('a no-show cancels the match without rating it', async () => {
    const { a, ma } = await matched();
    const pa = await seat(ma.code, ma.ticket, 'x');
    const err = pa.c.next('error');
    await tickAt(ma.code, (st) => st.createdAt + RECONNECT_GRACE_MS + 1);
    expect((await err).message).toMatch(/didn't join/);
    expect((await get<RankedProfile>('/ranked', a.token)).flags.played).toBe(0);
  });
});
