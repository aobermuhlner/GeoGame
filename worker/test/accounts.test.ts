import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CAPITAL_BY_CODE,
  COUNTDOWN_MS,
  COUNTRY_BY_CODE,
  ROUND_TIME_MS,
  CHALLENGE_BY_ID,
  challengeCodes,
  dayOf,
  type DailyResponse,
  type LeaderboardResponse,
  type LoginResponse,
  type MeResponse,
} from '@flagduel/shared';
import type { Accounts } from '../src/accounts';
import { verifyGoogleIdToken, type Jwk } from '../src/google';
import { BASE, ORIGIN } from './helpers';

const db = () => env.ACCOUNTS.getByName('main');

function call(path: string, init: { method?: string; token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { Origin: init.origin ?? ORIGIN };
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

/** Today's countries of `mode` for a user (read from the stored run). */
async function codesOf(token: string, mode: 'flags' | 'capitals') {
  const res = await call(`/daily/${mode}/start`, { method: 'POST', token });
  const { run } = (await res.json()) as DailyResponse;
  const user = await db().authenticate(token);
  return { run, user: user! };
}

describe('practice flags', () => {
  it('serves any flag by ISO code, no session needed', async () => {
    const res = await exports.default.fetch(new Request(`${BASE}/practice/flags/de`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('<svg');
    expect((await exports.default.fetch(new Request(`${BASE}/practice/flags/ZZ`))).status).toBe(404);
    expect((await exports.default.fetch(new Request(`${BASE}/practice/flags/../x`))).status).toBe(404);
  });

  it('serves landmark photos by id from the private assets, never at their file path', async () => {
    const res = await exports.default.fetch(new Request(`${BASE}/practice/landmarks/eiffel-tower`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    expect((await exports.default.fetch(new Request(`${BASE}/practice/landmarks/atlantis`))).status).toBe(404);
    expect((await exports.default.fetch(new Request(`${BASE}/eiffel-tower.jpg`))).status).toBe(404);
  });
});

describe('auth', () => {
  it('dev login creates an account, reuses it, and /me needs a session', async () => {
    const a = await devLogin('Adrian');
    const b = await devLogin('adrian');
    expect(b.user.id).toBe(a.user.id);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);

    expect((await call('/me')).status).toBe(401);
    const me = (await (await call('/me', { token: a.token })).json()) as MeResponse;
    expect(me.user.displayName).toBe('Adrian');
    expect(me.stats).toMatchObject({ daysPlayed: 0, streak: 0, daily: { flags: { played: 0, best: null } } });

    const renamed = await call('/me', { method: 'PATCH', token: a.token, body: { displayName: '  Adi  ' } });
    expect(((await renamed.json()) as { user: { displayName: string } }).user.displayName).toBe('Adi');

    await call('/auth/logout', { method: 'POST', token: a.token });
    expect((await call('/me', { token: a.token })).status).toBe(401);
    expect((await call('/me', { token: b.token })).status).toBe(200);
  });

  it('guest login works from production and makes a new account each time', async () => {
    const origin = 'https://aobermuhlner.github.io';
    const login = async (name: string) => {
      const res = await call('/auth/guest', { method: 'POST', body: { name }, origin });
      expect(res.status).toBe(200);
      return (await res.json()) as LoginResponse;
    };
    const a = await login('Guesty');
    const b = await login('Guesty');
    expect(a.user).toMatchObject({ displayName: 'Guesty', guest: true });
    expect(b.user.id).not.toBe(a.user.id);
    expect((await call('/me', { token: a.token, origin })).status).toBe(200);
    expect((await call('/auth/guest', { method: 'POST', body: { name: '   ' }, origin })).status).toBe(400);
  });

  it('dev login is refused from non-local origins', async () => {
    const res = await call('/auth/dev', { method: 'POST', body: { name: 'Eve' }, origin: 'https://aobermuhlner.github.io' });
    expect(res.status).toBe(404);
    const cfg = await (await call('/auth/config', { origin: 'https://aobermuhlner.github.io' })).json();
    expect(cfg).toEqual({ googleClientId: 'test-client.apps.googleusercontent.com', devLogin: false, guestLogin: true });
  });

  it('rejects forbidden origins and bad Google credentials', async () => {
    expect((await call('/me', { origin: 'https://evil.example' })).status).toBe(403);
    const res = await call('/auth/google', { method: 'POST', body: { credential: 'a.b.c' } });
    expect(res.status).toBe(401);
  });
});

describe('linking a guest to Google', () => {
  const guest = async (name: string) => {
    const res = await call('/auth/guest', { method: 'POST', body: { name } });
    return (await res.json()) as LoginResponse;
  };
  const claims = (sub: string) => ({ sub, email: `${sub}@example.com`, given_name: 'Googler' });
  const scalar = (query: string, ...params: string[]) =>
    runInDurableObject(db(), (_: Accounts, state) => state.storage.sql.exec(query, ...params).one().v);
  const count = (table: string, userId: string) => scalar(`SELECT COUNT(*) AS v FROM ${table} WHERE user_id = ?`, userId);

  it('a new Google account keeps the guest id, name and progress, and swaps the session', async () => {
    const g = await guest('Wanderer');
    await db().dailyStart(g.user.id, 'flags');
    const linked = await db().linkGoogle(g.user.id, claims('link-new'));
    expect(linked!.user).toMatchObject({ id: g.user.id, displayName: 'Wanderer', email: 'link-new@example.com', guest: false });
    expect(await db().authenticate(g.token)).toBeNull();
    expect(await db().authenticate(linked!.token)).toMatchObject({ id: g.user.id });
    expect(await count('daily_runs', g.user.id)).toBe(1);

    // From now on it is a normal Google account: signing in finds it, linking again is refused.
    expect((await db().loginGoogle(claims('link-new'))).user.id).toBe(g.user.id);
    expect(await db().linkGoogle(g.user.id, claims('link-other'))).toBeNull();
  });

  it('an existing Google account absorbs the guest; its own rows win on conflicts', async () => {
    const acc = await db().loginGoogle(claims('link-existing'));
    const g = await guest('Temp');
    const rival = await guest('Rival');
    await db().dailyStart(acc.user.id, 'flags');
    await db().dailyStart(g.user.id, 'flags'); // same game as the account's run → dropped
    await db().dailyStart(g.user.id, 'capitals'); // moves over
    await db().rankedResult('link-m1', 'flags', [g.user.id, rival.user.id], 0);

    const linked = await db().linkGoogle(g.user.id, claims('link-existing'));
    expect(linked!.user).toMatchObject({ id: acc.user.id, displayName: 'Googler', guest: false });
    expect(await db().authenticate(g.token)).toBeNull();
    expect(await count('daily_runs', acc.user.id)).toBe(2);
    expect(await count('daily_runs', g.user.id)).toBe(0);
    expect(await count('ratings', g.user.id)).toBe(0);
    expect((await db().rankedProfile(acc.user.id)).flags).toMatchObject({ played: 1, wins: 1 });
    expect((await db().rankedBoard(acc.user.id, 'flags')).you).toMatchObject({ name: 'Googler', played: 1 });
    expect(await scalar("SELECT player_a AS v FROM ranked_matches WHERE id = 'link-m1'")).toBe(acc.user.id);
    expect(await scalar('SELECT COUNT(*) AS v FROM users WHERE id = ?', g.user.id)).toBe(0);
  });

  it('merging keeps the faster challenge time and adds up the runs', async () => {
    const acc = await db().loginGoogle(claims('link-challenge'));
    const g = await guest('Fast');
    const europe = challengeCodes(CHALLENGE_BY_ID.europe);
    const africa = challengeCodes(CHALLENGE_BY_ID.africa);
    await db().challengeResult(acc.user.id, 'europe', europe, 200_000);
    await db().challengeResult(g.user.id, 'europe', europe, 150_000);
    await db().challengeResult(g.user.id, 'europe', europe, 180_000);
    await db().challengeResult(g.user.id, 'africa', africa, 300_000);

    await db().linkGoogle(g.user.id, claims('link-challenge'));
    expect((await db().challenges(acc.user.id)).bests).toEqual({ europe: 150_000, africa: 300_000 });
    expect(await scalar("SELECT runs AS v FROM challenge_bests WHERE user_id = ? AND challenge = 'europe'", acc.user.id)).toBe(3);
    expect(await count('challenge_bests', g.user.id)).toBe(0);
  });

  it('HTTP: needs a guest session and a valid credential', async () => {
    const g = await guest('Nobody');
    const res = await call('/auth/google/link', { method: 'POST', token: g.token, body: { credential: 'a.b.c' } });
    expect(res.status).toBe(400);
    // A bad credential must not end the guest's session.
    expect((await call('/me', { token: g.token })).status).toBe(200);
    expect((await call('/auth/google/link', { method: 'POST', body: { credential: 'a.b.c' } })).status).toBe(401);
    const dev = await devLogin('NotAGuest');
    const r2 = await call('/auth/google/link', { method: 'POST', token: dev.token, body: { credential: 'a.b.c' } });
    expect(r2.status).toBe(409);
  });
});

describe('Google ID tokens', () => {
  const CLIENT = 'client-123';
  const b64url = (b: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));

  async function setup() {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk), kid: 'k1' };
    const sign = async (claims: object, kid = 'k1') => {
      const data = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`;
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(data));
      return `${data}.${b64url(sig)}`;
    };
    return { sign, keys: async () => [jwk] };
  }

  it('accepts a valid token and rejects wrong audience, expiry, issuer, key or signature', async () => {
    const { sign, keys } = await setup();
    const now = Date.now();
    const good = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '42', exp: now / 1000 + 600, iat: now / 1000, name: 'A' };
    expect(await verifyGoogleIdToken(await sign(good), CLIENT, now, keys)).toMatchObject({ sub: '42' });
    expect(await verifyGoogleIdToken(await sign({ ...good, aud: 'other' }), CLIENT, now, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await sign({ ...good, exp: now / 1000 - 3600 }), CLIENT, now, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await sign({ ...good, iss: 'evil.com' }), CLIENT, now, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(good, 'k2'), CLIENT, now, keys)).toBeNull();
    const t = await sign(good);
    const tampered = t.slice(0, t.indexOf('.') + 1) + enc({ ...good, sub: '43' }) + t.slice(t.lastIndexOf('.'));
    expect(await verifyGoogleIdToken(tampered, CLIENT, now, keys)).toBeNull();
  });
});

describe('daily challenge', () => {
  it('plays a full run with controlled time (RPC), then locks it', async () => {
    const { token, user } = await devLogin('Solo');
    const t0 = Date.now();
    const start = await db().dailyStart(user.id, 'flags', t0);
    expect(start.run).toMatchObject({ phase: 'countdown', round: 1, totalRounds: 10, flag: null, score: 0 });

    const state = async () => JSON.parse((await internalRun(user.id, 'flags', t0))!);
    let now = t0 + COUNTDOWN_MS;
    // Flag is hidden until the round starts.
    const tok0 = (await state()).rounds[0].token as string;
    expect(await db().dailyFlag(tok0, now - 1)).toBeNull();
    expect(await db().dailyFlag(tok0, now)).toMatch(/^[A-Z]{2}$/);

    for (let round = 1; round <= 10; round++) {
      const code = (await state()).codes[round - 1] as string;
      if (round > 1) {
        const next = await db().dailyNext(user.id, 'flags', round - 1, now);
        expect(next!.run).toMatchObject({ phase: 'playing', round });
      }
      if (round === 1) {
        expect((await db().dailyGuess(user.id, 'flags', 1, 'Atlantis', now))!.outcome).toBe('wrong');
      }
      if (round === 10) {
        // Let the last one time out.
        now += ROUND_TIME_MS;
        const v = await db().dailyGet(user.id, 'flags', now);
        expect(v!.run.reveal).toMatchObject({ end: 'timeout', points: 0 });
      } else {
        const r = await db().dailyGuess(user.id, 'flags', round, COUNTRY_BY_CODE[code].name, now);
        expect(r!.outcome).toBe('correct');
        expect(r!.run.reveal!.answer).toBe(COUNTRY_BY_CODE[code].name);
      }
      now += 1000;
    }
    const done = await db().dailyGet(user.id, 'flags', now);
    expect(done!.run.phase).toBe('finished');
    expect(done!.run.score).toBe(95 + 8 * 100);

    // Starting again returns the finished run instead of a new one.
    const again = await db().dailyStart(user.id, 'flags', now);
    expect(again.run).toMatchObject({ phase: 'finished', score: 895 });

    const summary = (await (await call('/daily', { token })).json()) as { modes: Record<string, unknown> };
    expect(summary.modes.flags).toMatchObject({ status: 'finished', score: 895, rank: expect.any(Number) });
    expect(summary.modes.capitals).toMatchObject({ status: 'new', score: null });

    const me = (await (await call('/me', { token })).json()) as MeResponse;
    expect(me.stats).toMatchObject({ daysPlayed: 1, streak: 1, daily: { flags: { played: 1, best: 895 } } });
  });

  it('HTTP: start, guess with the wrong round, pass, and everyone gets the same countries', async () => {
    const a = await devLogin('Alpha');
    const b = await devLogin('Beta');
    const ra = await codesOf(a.token, 'capitals');
    await codesOf(b.token, 'capitals');
    const today = dayOf(Date.now());
    const sa = JSON.parse((await internalRun(ra.user.id, 'capitals', Date.now()))!);
    const sb = JSON.parse((await internalRun((await db().authenticate(b.token))!.id, 'capitals', Date.now()))!);
    expect(sa.codes).toEqual(sb.codes);
    expect(sa.date).toBe(today);
    expect(CAPITAL_BY_CODE[sa.codes[0]]).toBeDefined();

    const early = await call('/daily/capitals/guess', { method: 'POST', token: a.token, body: { round: 1, text: 'x' } });
    expect(((await early.json()) as { outcome: string }).outcome).toBe('ignored'); // still counting down
    expect((await call('/daily/capitals/pass', { method: 'POST', token: a.token, body: {} })).status).toBe(400);
    expect((await call('/daily/nope/start', { method: 'POST', token: a.token })).status).toBe(404);
    expect((await call('/daily/flags', { token: a.token })).status).toBe(404); // not started
  });

  it('leaderboard ranks finished runs, ties share a rank, overall sums both games', async () => {
    const t = Date.now();
    const users = [];
    for (const [name, correct] of [['Lb1', 3], ['Lb2', 5], ['Lb3', 5]] as const) {
      const { user, token } = await devLogin(name);
      users.push({ user, token });
      await db().dailyStart(user.id, 'flags', t);
      let now = t + COUNTDOWN_MS;
      for (let round = 1; round <= 10; round++) {
        if (round > 1) await db().dailyNext(user.id, 'flags', round - 1, now);
        const code = JSON.parse((await internalRun(user.id, 'flags', t))!).codes[round - 1];
        if (round <= correct) await db().dailyGuess(user.id, 'flags', round, COUNTRY_BY_CODE[code].name, now);
        else await db().dailyPass(user.id, 'flags', round, now);
      }
    }
    const res = await call('/leaderboard?board=flags', { token: users[0].token });
    const lb = (await res.json()) as LeaderboardResponse;
    const mine = lb.entries.filter((e) => e.name.startsWith('Lb'));
    expect(mine.map((e) => [e.name, e.score])).toEqual([
      ['Lb2', 500],
      ['Lb3', 500],
      ['Lb1', 300],
    ]);
    expect(mine[0].rank).toBe(mine[1].rank);
    expect(mine.every((e) => e.timeMs === 0)).toBe(true); // everyone answered the moment each round started
    expect(lb.you).toMatchObject({ name: 'Lb1', score: 300, you: true });

    const overall = (await (await call('/leaderboard?board=overall')).json()) as LeaderboardResponse;
    expect(overall.you).toBeNull();
    expect(overall.entries.find((e) => e.name === 'Lb2')!.score).toBe(500);
    expect((await call('/leaderboard?board=bogus')).status).toBe(400);
  });

  it('leaderboard shows run time and ranks equal scores by it', async () => {
    const t = Date.now();
    for (const [name, delay] of [['Tm1', 3000], ['Tm2', 1000]] as const) {
      const { user } = await devLogin(name);
      await db().dailyStart(user.id, 'capitals', t);
      let now = t + COUNTDOWN_MS;
      for (let round = 1; round <= 10; round++) {
        if (round > 1) await db().dailyNext(user.id, 'capitals', round - 1, now);
        now += delay;
        await db().dailyPass(user.id, 'capitals', round, now);
      }
      const done = await db().dailyGet(user.id, 'capitals', now);
      expect(done!.run).toMatchObject({ phase: 'finished', score: 0, timeMs: 10 * delay });
    }
    const lb = (await (await call('/leaderboard?board=capitals')).json()) as LeaderboardResponse;
    const mine = lb.entries.filter((e) => e.name.startsWith('Tm'));
    expect(mine.map((e) => [e.name, e.timeMs])).toEqual([
      ['Tm2', 10_000],
      ['Tm1', 30_000],
    ]);
    expect(mine[0].rank).toBeLessThan(mine[1].rank);
  });
});

/** Raw stored run JSON (test-only peek at the answers). */
function internalRun(userId: string, mode: string, now: number) {
  return runSql<{ state: string }>(
    'SELECT state FROM daily_runs WHERE user_id = ? AND date = ? AND mode = ?',
    userId,
    dayOf(now),
    mode,
  ).then((rows) => rows[0]?.state ?? null);
}

function runSql<T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]) {
  return runInDurableObject(db(), (_obj: Accounts, state) => state.storage.sql.exec<T>(query, ...args).toArray());
}

describe('admin stats', () => {
  const admin = (token?: string, query = '') =>
    exports.default.fetch(
      new Request(`${BASE}/admin/stats${query}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    );

  it('needs the admin token, and hides the route otherwise', async () => {
    expect((await admin()).status).toBe(404);
    expect((await admin('wrong-token')).status).toBe(404);
    const { token } = await devLogin('NotAdmin');
    expect((await admin(token)).status).toBe(404);
    const res = await admin('test-admin-token', '?days=3');
    expect(res.status).toBe(200);
    const stats = (await res.json()) as { days: { date: string }[] };
    expect(stats.days.map((d) => d.date)).toEqual([0, 1, 2].map((i) => dayOf(Date.now() - i * 86_400_000)));
  });

  it('serves the stats page without any data in it', async () => {
    const res = await exports.default.fetch(new Request(`${BASE}/admin`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
    expect(await res.text()).toContain('/admin/stats');
  });

  it('counts daily runs and matches per day, with the full daily ranking', async () => {
    const t = Date.parse('2031-03-05T12:00:00Z');
    const { user } = await devLogin('StatsA');
    const { user: other } = await devLogin('StatsB');
    await db().dailyStart(user.id, 'flags', t);
    let now = t + COUNTDOWN_MS;
    for (let round = 1; round <= 10; round++) {
      if (round > 1) await db().dailyNext(user.id, 'flags', round - 1, now);
      await db().dailyPass(user.id, 'flags', round, now);
    }
    await db().dailyStart(other.id, 'flags', t); // started, never finished
    await db().recordPlay('duel', ['flags', 'capitals'], 2, t);
    await db().recordPlay('duel', ['flags'], 2, t);
    await db().recordPlay('quick', ['higher', 'higher'], 5, t); // a game listed twice counts once
    await db().recordPlay('duel', ['flags'], 2, t - 86_400_000);

    const { days } = await db().adminStats(2, t);
    const [today, yesterday] = days;
    expect(today.date).toBe('2031-03-05');
    expect(today.daily.flags).toEqual({ started: 2, finished: 1 });
    expect(today.dailyPlayers).toBe(2);
    expect(today.matches).toEqual({
      duel: { flags: { matches: 2, players: 4 }, capitals: { matches: 1, players: 2 } },
      quick: { higher: { matches: 1, players: 5 } },
    });
    expect(today.boards.flags.map((e) => e.name)).toEqual(['StatsA']);
    expect(today.higher).toBeNull(); // no Higher or Lower puzzle was drawn that day (and looking didn't draw one)
    expect(yesterday.matches).toEqual({ duel: { flags: { matches: 1, players: 2 } } });
    expect((await db().adminStats(2, t)).days[0].higher).toBeNull();
  });
});
