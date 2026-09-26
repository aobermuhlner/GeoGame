# Flag Duel

Real-time 2-player flag guessing game. Both players see the same flag at the same moment; whoever names it first wins the point. 10 rounds per match, server-authoritative.

```
/frontend   Vite + TypeScript + Preact  → GitHub Pages
/worker     Cloudflare Worker + SQLite-backed Durable Object `Room` (one per lobby)
/shared     Country data, region table, guess normalization, game rules
```

## Setup

Requires Node 20+.

```bash
npm install
```

## Local development

```bash
npm run dev          # wrangler dev on :8787 + Vite on :5173, together
npm test             # Vitest: shared rules/data + Worker/Durable Object tests (workerd)
```

Open http://localhost:5173 in two tabs to play against yourself: create a lobby in one, then open
the copied invite link (`?room=CODE`) in the other. Each tab is its own player (the session id lives
in `sessionStorage`, so a reload reclaims your seat but a second tab gets a new one).

The frontend talks to `VITE_WORKER_URL` (default `http://localhost:8787`). Allowed browser origins
for the Worker are set in `worker/wrangler.jsonc` → `vars.ALLOWED_ORIGINS`.

The home screen also has a dev-only **"Practice against a bot"** link that runs a local mock match
without the backend. Append `?bot=lazy` for a bot that never answers correctly.

### API

| Route | Purpose |
|---|---|
| `POST /rooms` | Create a lobby → `{ code }` (5 chars, no 0/O/1/I) |
| `GET /rooms/:code` | Lobby exists? → `{ code, phase, players }` or 404 |
| `GET /rooms/:code/ws` | WebSocket to the room's Durable Object (protocol: `shared/src/messages.ts`) |
| `GET /flags/:token` | SVG of a started round's flag. Tokens are random per round, so URLs never reveal the country |

## Editing data

- Region assignment: [`shared/src/regions.ts`](shared/src/regions.ts) — one ISO list per region.
- Country names and accepted aliases: [`shared/src/countries.ts`](shared/src/countries.ts).
- Guess matching is case-, accent- and punctuation-insensitive (`shared/src/normalize.ts`).
