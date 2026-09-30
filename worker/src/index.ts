import {
  BOARD_IDS,
  FLAG_TOKEN_RE,
  LANDMARK_BY_ID,
  MODE_IDS,
  isRankedMode,
  ROOM_CODE_LENGTH,
  ROOM_CODE_RE,
  cleanName,
  randomRoomCode,
  type AuthConfig,
  type BoardId,
  type ModeId,
  type RankedModeId,
  type UserView,
} from '@flagduel/shared';
import { FLAGS } from './generated/flags';
import { verifyGoogleIdToken } from './google';

export { Room } from './room';
export { Accounts } from './accounts';
export { Matchmaker } from './matchmaker';
export { GroupRoom } from './group';

const DAILY_FLAG_RE = /^[0-9a-f]{32}$/;
const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/;

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  return allowed.includes(origin) ? origin : null;
}

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Vary', 'Origin');
  return out;
}

const svgResponse = (svg: string) =>
  new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });

const imageHeaders = (type: string) => ({
  'Content-Type': type,
  'Cache-Control': 'private, max-age=3600',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
});

/**
 * The image of a round's item: a flag SVG (bundled) or a landmark photo (Workers static assets, which are
 * only reachable through here: `run_worker_first` keeps them off the public URL space).
 */
async function itemImage(item: string | null, env: Env): Promise<Response> {
  if (item && FLAGS[item]) return svgResponse(FLAGS[item]);
  if (item && LANDMARK_BY_ID[item]) {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local/${item}.jpg`));
    if (res.ok) return new Response(res.body, { headers: imageHeaders('image/jpeg') });
  }
  return new Response('Not found', { status: 404 });
}

const isLocalOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await request.json();
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function bearer(request: Request): string | null {
  const t = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  return t && SESSION_TOKEN_RE.test(t) ? t : null;
}

const isRound = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < 1000;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, message: string) => json({ error: message }, status);
/** 200 with the result, or 404 when there is no daily run to act on. */
const runOr404 = (r: unknown) => (r ? json(r) : fail(404, 'No daily game started'));

/** Accounts, daily challenge and leaderboard routes (the caller has checked the origin). */
async function accountRoutes(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
  const db = env.ACCOUNTS.getByName('main');
  const path = url.pathname;
  const method = request.method;

  // ----- no session needed -----
  if (path === '/auth/config' && method === 'GET') {
    const config: AuthConfig = {
      googleClientId: env.GOOGLE_CLIENT_ID || null,
      devLogin: env.DEV_LOGIN === 'true' && isLocalOrigin(origin),
      guestLogin: true,
    };
    return json(config);
  }
  if (path === '/auth/google' && method === 'POST') {
    if (!env.GOOGLE_CLIENT_ID) return fail(503, 'Google sign-in is not configured');
    const { credential } = await readBody(request);
    if (typeof credential !== 'string' || credential.length > 4096) return fail(400, 'Missing credential');
    const claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID).catch(() => null);
    if (!claims) return fail(401, 'Invalid Google sign-in');
    return json(await db.loginGoogle(claims));
  }
  if (path === '/auth/guest' && method === 'POST') {
    const name = cleanName((await readBody(request)).name);
    if (!name) return fail(400, 'Enter a name');
    return json(await db.loginGuest(name));
  }
  if (path === '/auth/dev' && method === 'POST') {
    // Two locks: the env flag (off in production) and a localhost page.
    if (env.DEV_LOGIN !== 'true' || !isLocalOrigin(origin)) return fail(404, 'Not found');
    const name = cleanName((await readBody(request)).name);
    if (!name) return fail(400, 'Enter a name');
    return json(await db.loginDev(name));
  }

  const token = bearer(request);
  const user: UserView | null = token ? await db.authenticate(token) : null;

  // GET /leaderboard?board=flags|capitals|overall — signed out too
  if (path === '/leaderboard' && method === 'GET') {
    const board = (url.searchParams.get('board') ?? 'overall') as BoardId;
    if (!BOARD_IDS.includes(board)) return fail(400, 'Unknown board');
    return json(await db.leaderboard(user?.id ?? null, board));
  }

  // GET /higher/leaderboard — today's Higher or Lower ranking, signed out too
  if (path === '/higher/leaderboard' && method === 'GET') return json(await db.higherBoard(user?.id ?? null));

  // GET /ranked/leaderboard?mode=flags — signed out too
  if (path === '/ranked/leaderboard' && method === 'GET') {
    const mode = (url.searchParams.get('mode') ?? 'flags') as RankedModeId;
    if (!isRankedMode(mode)) return fail(400, 'Unknown mode');
    return json(await db.rankedBoard(user?.id ?? null, mode));
  }

  // ----- signed in -----
  if (!token || !user) return fail(401, 'Not signed in');

  if (path === '/ranked' && method === 'GET') return json(await db.rankedProfile(user.id));

  // POST /auth/google/link { credential } — a guest keeps their progress by attaching a Google account
  if (path === '/auth/google/link' && method === 'POST') {
    if (!env.GOOGLE_CLIENT_ID) return fail(503, 'Google sign-in is not configured');
    if (!user.guest) return fail(409, 'Only guest accounts can be linked');
    const { credential } = await readBody(request);
    if (typeof credential !== 'string' || credential.length > 4096) return fail(400, 'Missing credential');
    const claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID).catch(() => null);
    if (!claims) return fail(400, 'Invalid Google sign-in');
    const linked = await db.linkGoogle(user.id, claims);
    return linked ? json(linked) : fail(409, 'Only guest accounts can be linked');
  }

  // /ranked/:mode/beginner (POST) · /ranked/:mode/placement (GET) · /ranked/:mode/placement/start|guess|pass|next (POST)
  const rk = /^\/ranked\/([a-z]+)\/(beginner|placement)(?:\/(start|guess|pass|next))?$/.exec(path);
  if (rk && isRankedMode(rk[1])) {
    const mode = rk[1];
    const action = rk[3];
    const noTest = (r: unknown) => (r ? json(r) : fail(404, 'No placement test to play'));
    if (rk[2] === 'beginner') return method === 'POST' && !action ? json(await db.rankedBeginner(user.id, mode)) : fail(404, 'Not found');
    if (!action) return method === 'GET' ? noTest(await db.placementGet(user.id, mode)) : fail(405, 'Method not allowed');
    if (method !== 'POST') return fail(405, 'Method not allowed');
    if (action === 'start') {
      const r = await db.placementStart(user.id, mode);
      return r ? json(r) : fail(409, 'Ranked is already unlocked for this game');
    }
    const b = await readBody(request);
    if (!isRound(b.round)) return fail(400, 'Missing round');
    switch (action) {
      case 'guess':
        if (typeof b.text !== 'string' || b.text.length > 80) return fail(400, 'Missing guess');
        return noTest(await db.placementGuess(user.id, mode, b.round, b.text));
      case 'pass':
        return noTest(await db.placementPass(user.id, mode, b.round));
      default:
        return noTest(await db.placementNext(user.id, mode, b.round));
    }
  }

  if (path === '/auth/logout' && method === 'POST') {
    await db.logout(token);
    return json({ ok: true });
  }
  if (path === '/me' && method === 'GET') return json(await db.me(user.id));
  if (path === '/me' && method === 'PATCH') {
    const name = cleanName((await readBody(request)).displayName);
    if (!name) return fail(400, 'Enter a name');
    return json({ user: await db.setDisplayName(user.id, name) });
  }
  if (path === '/daily' && method === 'GET') return json(await db.dailySummary(user.id));

  // /higher/daily (GET) · /higher/daily/start|pick|next (POST)
  const hl = /^\/higher\/daily(?:\/(start|pick|next))?$/.exec(path);
  if (hl) {
    const noRun = (r: unknown) => (r ? json(r) : fail(404, 'No Higher or Lower game started'));
    if (!hl[1]) return method === 'GET' ? noRun(await db.higherGet(user.id)) : fail(405, 'Method not allowed');
    if (method !== 'POST') return fail(405, 'Method not allowed');
    if (hl[1] === 'start') return json(await db.higherStart(user.id));
    const b = await readBody(request);
    if (!isRound(b.round)) return fail(400, 'Missing round');
    if (hl[1] === 'next') return noRun(await db.higherNext(user.id, b.round));
    if (typeof b.code !== 'string' || !/^[A-Z]{2}$/.test(b.code)) return fail(400, 'Missing country');
    return noRun(await db.higherPick(user.id, b.round, b.code));
  }

  // /daily/:mode  (GET)   ·   /daily/:mode/start|guess|draft|pass|next  (POST)
  const m = /^\/daily\/([a-z]+)(?:\/(start|guess|draft|pass|next))?$/.exec(path);
  if (!m || !(MODE_IDS as readonly string[]).includes(m[1])) return fail(404, 'Not found');
  const mode = m[1] as ModeId;
  const action = m[2];

  if (!action) return method === 'GET' ? runOr404(await db.dailyGet(user.id, mode)) : fail(405, 'Method not allowed');
  if (method !== 'POST') return fail(405, 'Method not allowed');
  if (action === 'start') return json(await db.dailyStart(user.id, mode));

  const b = await readBody(request);
  if (!isRound(b.round)) return fail(400, 'Missing round');
  switch (action) {
    case 'guess':
      if (typeof b.text !== 'string' || b.text.length > 80) return fail(400, 'Missing guess');
      return runOr404(await db.dailyGuess(user.id, mode, b.round, b.text));
    case 'draft':
      if (typeof b.text !== 'string' || b.text.length > 80) return fail(400, 'Missing draft');
      return runOr404(await db.dailyDraft(user.id, mode, b.round, b.text));
    case 'pass':
      return runOr404(await db.dailyPass(user.id, mode, b.round));
    default:
      return runOr404(await db.dailyNext(user.id, mode, b.round));
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }

    // GET /daily/flags/:token → SVG of a started daily round (loaded by <img>, so no Origin check)
    const dailyFlag = /^\/daily\/flags\/([^/]+)$/.exec(url.pathname);
    if (dailyFlag && request.method === 'GET') {
      const token = dailyFlag[1];
      return itemImage(DAILY_FLAG_RE.test(token) ? await env.ACCOUNTS.getByName('main').dailyFlag(token) : null, env);
    }

    // GET /practice/flags/:code → SVG by ISO code. Practice runs in the browser and is never scored,
    // so there is nothing to hide (the flag set is public anyway).
    const practiceFlag = /^\/practice\/flags\/([A-Za-z]{2})$/.exec(url.pathname);
    if (practiceFlag && request.method === 'GET') {
      const svg = FLAGS[practiceFlag[1].toUpperCase()];
      return svg ? svgResponse(svg) : new Response('Not found', { status: 404 });
    }

    // GET /practice/landmarks/:id → a landmark photo by id (practice only; same reasoning as the flags above)
    const practicePhoto = /^\/practice\/landmarks\/([a-z0-9-]+)$/.exec(url.pathname);
    if (practicePhoto && request.method === 'GET') return itemImage(practicePhoto[1], env);

    // GET /ranked/ws → WebSocket to the ranked queue (the session token is sent in the first message)
    if (url.pathname === '/ranked/ws' && request.method === 'GET') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      return env.MATCHMAKER.getByName('main').fetch(request);
    }

    // Accounts, daily challenge, leaderboards, ratings
    if (/^\/(auth|me|daily|leaderboard|ranked|higher)(\/|$)/.test(url.pathname)) {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      return withCors(await accountRoutes(request, env, url, origin), origin);
    }

    // POST /rooms → { code }
    if (url.pathname === '/rooms' && request.method === 'POST') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomRoomCode();
        if (await env.ROOMS.getByName(code).init(code)) return withCors(Response.json({ code }), origin);
      }
      return withCors(new Response('Could not allocate a room', { status: 503 }), origin);
    }

    // POST /groups → { code } (a group lobby; codes are shared with the 1 vs 1 rooms, never both)
    if (url.pathname === '/groups' && request.method === 'POST') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomRoomCode();
        if (await env.ROOMS.getByName(code).summary()) continue;
        if (await env.GROUPS.getByName(code).init(code)) return withCors(Response.json({ code }), origin);
      }
      return withCors(new Response('Could not allocate a room', { status: 503 }), origin);
    }

    // GET /rooms/:code → { code, kind, phase, players } (lets the join screen say "not found", and which kind it is)
    const info = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    if (info && request.method === 'GET') {
      const code = info[1].toUpperCase();
      const valid = ROOM_CODE_RE.test(code);
      const duel = valid ? await env.ROOMS.getByName(code).summary() : null;
      const group = valid && !duel ? await env.GROUPS.getByName(code).summary() : null;
      if (!duel && !group) return withCors(new Response('Room not found', { status: 404 }), origin);
      return withCors(Response.json(duel ? { code, kind: 'duel', ...duel } : { code, kind: 'group', ...group }), origin);
    }

    // GET /groups/:code/ws → WebSocket, handled by the group's Durable Object
    const gws = /^\/groups\/([^/]+)\/ws$/.exec(url.pathname);
    if (gws && request.method === 'GET') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      const code = gws[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('Room not found', { status: 404 });
      return env.GROUPS.getByName(code).fetch(request);
    }

    // GET /groups/flags/:token → image of a group round's item
    const gflag = /^\/groups\/flags\/([^/]+)$/.exec(url.pathname);
    if (gflag && request.method === 'GET') {
      const token = gflag[1];
      if (!FLAG_TOKEN_RE.test(token)) return new Response('Not found', { status: 404 });
      return itemImage(await env.GROUPS.getByName(token.slice(0, ROOM_CODE_LENGTH)).flag(token), env);
    }

    // GET /rooms/:code/ws → WebSocket, handled by the room's Durable Object
    const ws = /^\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if (ws && request.method === 'GET') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      const code = ws[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('Room not found', { status: 404 });
      return env.ROOMS.getByName(code).fetch(request);
    }

    // GET /flags/:token → SVG of the current round's flag (token = room code + random hex)
    const flag = /^\/flags\/([^/]+)$/.exec(url.pathname);
    if (flag && request.method === 'GET') {
      const token = flag[1];
      if (!FLAG_TOKEN_RE.test(token)) return new Response('Not found', { status: 404 });
      return itemImage(await env.ROOMS.getByName(token.slice(0, ROOM_CODE_LENGTH)).flag(token), env);
    }

    if (url.pathname === '/') return new Response('Flag Duel API', { headers: { 'Content-Type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
