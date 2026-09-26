import { FLAG_TOKEN_RE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_RE } from '@flagduel/shared';

export { Room } from './room';

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

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  // 32-char alphabet → no modulo bias
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
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
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }

    // POST /rooms → { code }
    if (url.pathname === '/rooms' && request.method === 'POST') {
      if (!origin) return new Response('Forbidden origin', { status: 403 });
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        if (await env.ROOMS.getByName(code).init(code)) return withCors(Response.json({ code }), origin);
      }
      return withCors(new Response('Could not allocate a room', { status: 503 }), origin);
    }

    // GET /rooms/:code → { code, phase, players } (lets the join screen say "not found")
    const info = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    if (info && request.method === 'GET') {
      const code = info[1].toUpperCase();
      const summary = ROOM_CODE_RE.test(code) ? await env.ROOMS.getByName(code).summary() : null;
      if (!summary) return withCors(new Response('Room not found', { status: 404 }), origin);
      return withCors(Response.json({ code, ...summary }), origin);
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
      const svg = await env.ROOMS.getByName(token.slice(0, ROOM_CODE_LENGTH)).flag(token);
      if (!svg) return new Response('Not found', { status: 404 });
      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      });
    }

    if (url.pathname === '/') return new Response('Flag Duel API', { headers: { 'Content-Type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
