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

Every game (Flags, Capitals, GeoLocate, Landmarks, Languages, GeoGuesser) can be played **once per day** (UTC). Everyone gets the same 10 rounds,
picked at random on the first request of the day. A correct answer scores 50 points plus up to 50 for
speed, minus 5 per wrong guess (minimum 10); passes and timeouts score 0. Finished runs go on today's
ranking (per game, plus an overall board summing both). The run is server-side: the timer keeps
running if you close the tab, and answers are only revealed after each round.

Finished runs show where you stand today: **Top X %** (rank ÷ players who finished that game today, rounded up;
`topPercent` in `shared/src/api.ts`).

### GeoGuesser

Estimate a number: a mountain's height, a river's length, a record temperature, a country's population, the year a
canal opened. 30 seconds per question, one locked-in estimate. The score is about closeness, never speed:

- **Solo and group games:** up to 100 points per question. Amounts that span orders of magnitude (people, areas,
  lengths, heights, money, counts) are judged by ratio, bounded ones (temperatures, years, shares, life expectancy)
  by difference; `toleranceOf` in `shared/src/guess.ts` says how far off scores 0.
- **Duels:** the closer estimate gets 1 point (both on a tie), a *spot-on* one (🎯, accuracy ≥ 90 %) 1 more.

**Units.** Answers travel and are scored in one canonical unit per quantity (°C, km, m, km²), so players from
different places play the very same question. Each player picks °C/°F, km/mi, m/ft and km²/mi² (the unit chip next to
the input, or Metric/US on the results; stored per browser, US units by default for `en-US`). The browser converts
what is typed and shows every number (answers, everyone's estimates) in the player's own units. The input accepts
"1,234", "1.234,5", "1.5 million", "1.5m", "3k", "−89" and "300 BC", and shows how it reads the text before you lock in.

**Questions** (`shared/src/guess.ts`): hand-picked facts in `shared/src/guessFacts.ts` (each with its source, checked
2026-09-30; values that change with every heatwave or survey are left out), plus questions generated from the country
statistics in `statsData.ts` for the 80 best-known countries. Population, area and density are only asked where the
three agree (the World Bank data has a few bad areas). A game picks one question per topic first, so it stays varied.
During a round the prompt carries the question text and quantity, not its id.

### Daily Higher or Lower

Two countries, one statistic: pick the one with the higher value. Everyone gets the same category and the same
chain of 16 countries that day: each question brings in a new country against the previous question's new one,
whose value is already shown (like the classic higher-or-lower game), so every country but the first and last is
asked twice. The links get closer calls as the run goes on. 10 seconds per question; a timeout counts as a mistake. You always play all 15, but the ranking is about **how far you get
without a mistake**: correct answers in a row from the first question rank first, then total correct answers, then
total time. So mistakes at questions 10 and 11 (9 flawless) beat a single mistake at question 3 (2 flawless).
The category rotates daily through all of them (`dailyStat`), each used once before any repeats.

### Practice

Hovering **Practice** in the menu bar lists the games; picking one opens its settings (game + regions,
like the multiplayer lobby). A practice run is one game of 10 random countries from the chosen regions,
played as often as you like. It runs entirely in the browser with the shared solo rules and is never
sent to the server, ranked or counted in stats. Flags come from `GET /practice/flags/:code`, landmark photos from
`GET /practice/landmarks/:id`.

### Multiplayer — 1 vs 1

Real-time 2-player geography duel. Your account display name is your in-game name. Both players see the same flag at the same moment; whoever answers first wins the point. Server-authoritative.

In the lobby the host picks one or more **games** (played in order, 10 rounds each) and the regions:

| Game | Shown | Answer |
|---|---|---|
| Flags | flag | country name |
| Capitals | flag + country name | capital city |
| GeoLocate | country name | a click on the world map |
| Landmarks | a landmark photo, zoomed in, zooming out over 15 s | the country (one answer, locked in) |
| Languages | a sentence | its language (one answer, locked in) |
| GeoGuesser | a question | a number, in your own units (one estimate, locked in; closer wins) |

**Landmarks** and **Languages** are *lock-in* games: each player gets one answer per round (text that names no
country/language is refused, so a typo never locks you in). The opponent only sees *that* you locked in. The round
ends when both have answered or passed; the reveal shows both answers, the landmark on a map (or the sentence's
English translation). A correct answer is 1 point, the quicker of the correct answers 1 more. Solo (daily, practice):
one answer ends the round, a wrong one scores 0. They are not in ranked (ranked divisions are country pools).
Languages ignores the region selection.

A match with several games has a short "Next up" countdown between them; the overall winner has the most
points across all games (tie → fewer wrong guesses in total).

The lobby's Games card has two match types: **Geo Speed** (the flag games above) and **Geo Knowledge** (higher or
lower): two countries from the selected regions and a new category every round. It is not about speed: both
players have 20 seconds to lock in one country, the pick is final and the opponent only sees *that* you picked,
not what. Every correct pick is a point. All 10 rounds are always played; tied after them, a "Sudden death"
announcement is followed by extra rounds until exactly one player is right.

### Multiplayer — Group game

**Create group lobby** under Multiplayer opens a lobby for **2–8 players** (friends join with the same code box or
invite link as a duel; the Worker tells which kind of lobby a code is). It starts with every game selected, 5 rounds
each; the host can change games, rounds and regions like in a duel, and starts once at least two players are there.

Everyone answers every round. A right answer scores 50 points plus up to 50 for speed (linear in the time left);
in Flags, Capitals and GeoLocate each wrong try costs 5 (minimum 10). Landmarks, Languages and Higher or Lower take
one locked-in answer, and during the round others only see *that* you answered. Higher or Lower shows everyone the
same pair. A round ends when every connected player has answered or passed, or when time is up; the reveal lists
everyone's answer, time and points. After each game the **standings** show the new overall ranking — who moved up or
down and how many points they got — and the match moves on by itself. It ends on a **podium** (gold on the throne,
silver, bronze, then the rest) with a ranking table of each player's points per game. Ties: more right answers, then
less time on them. Leaving mid-game keeps your place in the ranking; the rounds just stop waiting for you. Group games
are not rated. Server-authoritative in the `GroupRoom` Durable Object (`worker/src/group.ts`, rules in `shared/src/group.ts`).

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
| `POST /higher/daily/start` · `GET /higher/daily` | Start (or resume) / get today's Higher or Lower → `{ run, now }` |
| `POST /higher/daily/pick` · `/next` | `{ round, code? }` → updated run (pick also returns `outcome`) |
| `GET /higher/leaderboard` | Today's Higher or Lower ranking (flawless, then correct, then time) |
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
- Landmarks: [`shared/src/landmarks.ts`](shared/src/landmarks.ts) (id, name, country, Wikipedia article, zoom focus,
  optional Commons file). Then run `node worker/scripts/fetch-landmarks.mjs`: it downloads the photo (only freely
  licensed Commons files), fits it into a 1600×1200 frame into `worker/landmarks/<id>.jpg`, and writes coordinates +
  credits to `shared/src/landmarkMeta.ts`. The photos are Workers static assets with `run_worker_first`, so they are
  only reachable through round tokens (or the practice route), never at a guessable URL.
- Languages: [`shared/src/languages.ts`](shared/src/languages.ts) (name + accepted aliases). Sentences come from
  Tatoeba: `node shared/scripts/fetch-sentences.mjs [id …]` writes `shared/src/sentencesData.ts`.
- Credits for photos and sentences are on `credits.html` (linked from the footer and each photo reveal).
- Country names and accepted aliases: [`shared/src/countries.ts`](shared/src/countries.ts).
- Capitals and accepted aliases: [`shared/src/capitals.ts`](shared/src/capitals.ts).
- Higher or Lower categories (label, question, number format): [`shared/src/higher.ts`](shared/src/higher.ts) → `STATS`.
  The numbers live in the generated [`shared/src/statsData.ts`](shared/src/statsData.ts) (World Bank indicators,
  Wikipedia for highest points); refresh them with `node shared/scripts/fetch-stats.mjs`, and put gaps or
  corrections into `MANUAL` in that script. Two countries are only paired when their values clearly differ
  (not equal, not the same once formatted, at least 2 % apart), so there are no ties.
- Guess matching is case-, accent- and punctuation-insensitive (`shared/src/normalize.ts`).
- The lobby map is generated at build time from `world-atlas` (`frontend/scripts/gen-map.mjs`);
  microstates too small for the 110m data are drawn as dots.

## Adding a game

Games are registered in [`shared/src/modes.ts`](shared/src/modes.ts): add an id to `MODE_IDS` and an entry to
`MODES` (label, lobby description, answer check, displayed answer, autocomplete). The lobby picker, round flow,
stage countdown, scoring and results table pick it up from there. A mode's `prompt` says what a round shows (flag,
photo or sentence), `pool` which items rounds are about, and `lockIn` makes it a one-answer game;
a game that needs a different kind of prompt would also extend `RoomView.prompt` and the game screen.
