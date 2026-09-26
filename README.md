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

## Deploy

The backend and frontend deploy separately. Do the Worker first; the frontend needs its URL.

### 1. Worker → Cloudflare (free plan)

```bash
npx wrangler login                 # once; opens the browser
npm run deploy:worker              # bundles flags + deploys worker/ with Wrangler
```

Wrangler prints the URL, e.g. `https://flag-duel.<your-subdomain>.workers.dev`. On a new account,
Cloudflare asks you to pick a `workers.dev` subdomain the first time.

- The Durable Object is SQLite-backed (`new_sqlite_classes` migration), as the free plan requires.
- Allowed browser origins live in `worker/wrangler.jsonc` → `vars.ALLOWED_ORIGINS`. It already
  contains `https://aobermuhlner.github.io`; add your origin there if you host the page elsewhere,
  then redeploy.
- Free-plan friendly by design: hibernatable WebSockets, alarms instead of timers, keep-alive pings
  answered without waking the object, rooms delete themselves 10 minutes after the last player left.

### 2. Frontend → GitHub Pages

One-time setup in the GitHub repo:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**
   `VITE_WORKER_URL` = the Worker URL from step 1 (no trailing slash)

Then every push to `main` that touches `frontend/` or `shared/` runs
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) and publishes to
`https://<user>.github.io/GeoGame/`. You can also run it manually from the Actions tab
(**Deploy frontend to GitHub Pages → Run workflow**). The Vite `base` is `/GeoGame/`
(`frontend/vite.config.ts`); change it if the repository is renamed.

[`.github/workflows/test.yml`](.github/workflows/test.yml) runs the tests and type checks on every push and PR.

## Editing data

- Region assignment: [`shared/src/regions.ts`](shared/src/regions.ts) — one ISO list per region.
- Country names and accepted aliases: [`shared/src/countries.ts`](shared/src/countries.ts).
- Guess matching is case-, accent- and punctuation-insensitive (`shared/src/normalize.ts`).
- The lobby map is generated at build time from `world-atlas` (`frontend/scripts/gen-map.mjs`);
  microstates too small for the 110m data are drawn as dots.
