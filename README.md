# Flag Duel

Geography flag games with accounts (Google sign-in), a **daily single-player challenge** with a daily
ranking, and a **real-time 1 vs 1 duel**. After signing in you land in the main lobby (account, stats,
today's status); the menu bar switches between **Lobby**, **Daily Games**, **Practice** and **Multiplayer**.

### Accounts

Sign in with **Google**, or play as a **guest** by picking a name. There are no passwords: Google proves
who you are, and the Worker only stores your Google id (`sub`), email, name and picture. A guest account
lives in the browser that holds its session token. Its lobby card offers **Link Google**, which turns the
guest into a Google account and keeps everything (daily runs, ratings, ranked matches). If that Google
account already exists, the guest's history is merged into it, keeping the Google account's own
row wherever both have one.

### Daily Games

Every game (Flags, Capitals) can be played **once per day** (UTC). Everyone gets the same 10 countries,
picked at random on the first request of the day. A correct answer scores 50 points plus up to 50 for
speed, minus 5 per wrong guess (minimum 10); passes and timeouts score 0. Finished runs go on today's
ranking (per game, plus an overall board summing both). The run is server-side: the timer keeps
running if you close the tab, and answers are only revealed after each round.

### Practice

Hovering **Practice** in the menu bar lists the games; picking one opens its settings (game + regions,
like the multiplayer lobby). A practice run is one game of 10 random countries from the chosen regions,
played as often as you like. It runs entirely in the browser with the shared solo rules and is never
sent to the server, ranked or counted in stats. Flags come from `GET /practice/flags/:code`.

### Multiplayer — 1 vs 1

Real-time 2-player geography duel. Your account display name is your in-game name. Both players see the same flag at the same moment; whoever answers first wins the point. Server-authoritative.

In the lobby the host picks one or more **games** (played in order, 10 rounds each) and the regions:

| Game | Shown | Answer |
|---|---|---|
| Flags | flag | country name |
| Capitals | flag + country name | capital city |

A match with several games has a short "Next up" countdown between them; the overall winner has the most
points across all games (tie → fewer wrong guesses in total).

### Ranked

**Find match** under Multiplayer queues you against a stranger in one game (Flags, Capitals or GeoLocate,
10 rounds). Each game has its own rating, **Glicko-2** (`shared/src/ranked.ts`): everyone starts at 1000
with a high rating deviation, so the first games move the rating a lot (about ±80). The swings shrink
to about ±15 as the deviation drops, and grow again after a long break. Losing to a stronger player costs
less than losing to a weaker one. Giving up or leaving counts as a loss; a match where someone never
connects is cancelled and not rated.

| Division | Rating | Regions played |
|---|---|---|
| Bronze | start | Europe |
| Silver | 1200+ | + South America, North America |
| Gold | 1400+ | + Central America, Asia |
| Platinum | 1600+ | + Africa |
| Diamond | 1800+ | + Caribbean, Oceania (all) |

Players from different divisions play the **lower** division's regions. The `Matchmaker` Durable Object
pairs waiting players whose rating gap fits a window that starts at 150 and widens by 25 per second of
waiting. The pair gets a fresh ranked `Room` whose two seats are claimed with secret tickets.

To try ranked locally you need two accounts, but both tabs of one origin share the login. Use
`http://localhost:5173` in one tab and `http://127.0.0.1:5173` in the other (both are in `ALLOWED_ORIGINS`;
if Vite only answers on one of them, start it with `--host 127.0.0.1`).

```
/frontend   Vite + TypeScript + Preact  → GitHub Pages
/worker     Cloudflare Worker + SQLite-backed Durable Objects: `Room` (one per lobby or ranked match),
            `Matchmaker` (one instance: the ranked queue) and
            `Accounts` (one instance: users, sessions, daily runs, ratings, leaderboards)
/shared     Country data, region table, guess normalization, game + daily rules, API types
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

Local sign-in: `worker/.dev.vars` (copy `worker/.dev.vars.example`) sets `DEV_LOGIN=true`, which shows a
name-only **"local dev sign-in"** on the login page. It only works from a `localhost` page and is off in
production. To try real Google sign-in locally, set `GOOGLE_CLIENT_ID` there as well (see Deploy).

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
| `GET /auth/config` | `{ googleClientId, devLogin }` for the login page |
| `POST /auth/google` | `{ credential }` (Google ID token) → `{ token, user }`; the Worker verifies the JWT against Google's keys |
| `POST /auth/google/link` | Guest session + `{ credential }` → `{ token, user }`: the guest becomes (or merges into) that Google account |
| `POST /auth/guest` | `{ name }` → `{ token, user }`: a new guest account |
| `POST /auth/dev` | `{ name }` → `{ token, user }` (only with `DEV_LOGIN=true` and a localhost origin) |
| `POST /auth/logout` | Ends the session |
| `GET /me`, `PATCH /me` | Account + stats; `{ displayName }` to rename |
| `GET /daily` | Today's status per game and when the next daily unlocks |
| `POST /daily/:mode/start` | Start (or resume) today's run → `{ run, now }` |
| `GET /daily/:mode` | Current run (settles a timed-out round) |
| `POST /daily/:mode/guess` · `/pass` · `/next` | `{ round, text? }` → updated run (guess also returns `outcome`) |
| `GET /daily/flags/:token` | SVG of a started daily round's flag |
| `GET /leaderboard?board=flags\|capitals\|overall` | Today's ranking (top 50 + your own placing) |
| `GET /ranked` | Your rating, division and record per game |
| `GET /ranked/leaderboard?mode=flags\|capitals\|locate` | Ranked ladder (top 50 + your own placing) |
| `GET /ranked/ws` | WebSocket to the ranked queue: send `{ t: 'queue', token, mode }`, get `matched` with a room code + seat ticket |

Account routes use `Authorization: Bearer <session token>` (random, 90 days, only its SHA-256 is stored).

## Deploy

The backend and frontend deploy separately. Do the Worker first; the frontend needs its URL.

### 1. Worker → Cloudflare (free plan)

```bash
npx wrangler login                 # once; opens the browser
npm run deploy:worker              # bundles flags + deploys worker/ with Wrangler
```

Wrangler prints the URL, e.g. `https://flag-duel.<your-subdomain>.workers.dev`. On a new account,
Cloudflare asks you to pick a `workers.dev` subdomain the first time.

- The Durable Objects are SQLite-backed (`new_sqlite_classes` migrations), as the free plan requires.
- **Google sign-in:** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an
  *OAuth client ID* of type **Web application**. Under *Authorized JavaScript origins* add
  `https://aobermuhlner.github.io` and `http://localhost:5173` (no redirect URIs needed — it uses the
  popup/ID-token flow). Put the client id (`…apps.googleusercontent.com`, public, not a secret) into
  `worker/wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` and redeploy. The frontend reads it from
  `GET /auth/config`, so no frontend rebuild is needed.
- Keep `DEV_LOGIN` `"false"` in `wrangler.jsonc`; it is only for `.dev.vars`.
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
- Capitals and accepted aliases: [`shared/src/capitals.ts`](shared/src/capitals.ts).
- Guess matching is case-, accent- and punctuation-insensitive (`shared/src/normalize.ts`).
- The lobby map is generated at build time from `world-atlas` (`frontend/scripts/gen-map.mjs`);
  microstates too small for the 110m data are drawn as dots.

## Adding a game

Games are registered in [`shared/src/modes.ts`](shared/src/modes.ts): add an id to `MODE_IDS` and an entry to
`MODES` (label, lobby description, answer check, displayed answer, autocomplete). The lobby picker, round flow,
stage countdown, scoring and results table pick it up from there. Every round still shows the country's flag;
a game that needs a different kind of prompt would also extend `RoomView.prompt` and the game screen.
