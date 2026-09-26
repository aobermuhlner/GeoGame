import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  DIVISIONS,
  RECONNECT_GRACE_MS,
  countriesInRegions,
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
    expect(st.regions).toEqual(DIVISIONS.bronze.regions);
  });

  it('keeps different minigames apart', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const [a, b] = await Promise.all([login(`F${tag}`), login(`G${tag}`)]);
    const qa = await Queue.open(a.token, 'flags');
    const qb = await Queue.open(b.token, 'locate');
    await Promise.all([qa.next('queued'), qb.next('queued')]);
    await new Promise((r) => setTimeout(r, 200));
    expect(qa.messages.some((m) => m.t === 'matched')).toBe(false);
    qa.close();
    qb.close();
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
    expect(s.room.countryCount).toBe(countriesInRegions(DIVISIONS.bronze.regions).length);

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
