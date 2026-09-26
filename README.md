# Flag Duel

Real-time 2-player flag guessing game. Both players see the same flag at the same moment; whoever names it first wins the point. 10 rounds per match, server-authoritative.

```
/frontend   Vite + TypeScript + Preact  → GitHub Pages
/worker     Cloudflare Worker + Durable Object `Room` (coming in milestone 2)
/shared     Country data, region table, guess normalization, game rules
```

## Setup

Requires Node 20+.

```bash
npm install
```

## Local development

```bash
npm run dev:web      # Vite on http://localhost:5173
npm test             # Vitest unit tests (shared rules, data, autocomplete)
```

Until the backend lands, the home screen has a dev-only **"Practice against a bot"** link that runs a
local mock match. Append `?bot=lazy` to the URL for a bot that never answers correctly (useful for
testing the input and reveal flow).

## Editing data

- Region assignment: [`shared/src/regions.ts`](shared/src/regions.ts) — one ISO list per region.
- Country names and accepted aliases: [`shared/src/countries.ts`](shared/src/countries.ts).
- Guess matching is case-, accent- and punctuation-insensitive (`shared/src/normalize.ts`).
