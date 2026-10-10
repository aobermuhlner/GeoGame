// Prints the admin stats: how much each game was played per day, and the daily rankings.
//
//   node scripts/stats.mjs [days] [--url https://flag-duel.<you>.workers.dev] [--json]
//
// The token comes from ADMIN_TOKEN in the environment, else from worker/.dev.vars (the local one).
// The URL comes from --url, else STATS_URL in the environment, else the local wrangler dev (port 8787).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const asJson = args.includes('--json') && args.splice(args.indexOf('--json'), 1);
const url = (flag('--url') ?? process.env.STATS_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const days = Number(args[0] ?? 7);

let token = process.env.ADMIN_TOKEN;
if (!token) {
  try {
    token = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1].trim();
  } catch {}
}
if (!token) {
  console.error('Set ADMIN_TOKEN (the same value as the worker secret).');
  process.exit(1);
}

const res = await fetch(`${url}/admin/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`${res.status} ${res.statusText}${res.status === 404 ? ' (wrong token, or ADMIN_TOKEN not set on the worker)' : ''}`);
  process.exit(1);
}
const stats = await res.json();
if (asJson) {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

const time = (ms) => `${(ms / 1000).toFixed(1)}s`;

// One overview table: a row per game, a column per day.
const rows = {};
const set = (key, date, v) => ((rows[key] ??= {})[date] = v);
for (const d of stats.days) {
  set('accounts: new', d.date, d.newAccounts);
  set('daily: players', d.date, d.dailyPlayers);
  for (const [mode, c] of Object.entries(d.daily)) set(`daily: ${mode}`, d.date, `${c.finished}/${c.started}`);
  for (const [kind, games] of Object.entries(d.matches))
    for (const [game, c] of Object.entries(games)) set(`${kind}: ${game}`, d.date, `${c.matches} (${c.players}p)`);
}
console.log('\nPlays per day  (daily: finished/started · matches: count (players))');
console.table(
  Object.fromEntries(
    Object.keys(rows)
      .sort()
      .map((k) => [k, Object.fromEntries(stats.days.map((d) => [d.date, rows[k][d.date] ?? '']))]),
  ),
);

for (const d of stats.days) {
  const boards = Object.entries(d.boards).filter(([, e]) => e.length);
  if (!boards.length && !d.higher?.entries.length) continue;
  console.log(`\n=== ${d.date} daily rankings ===`);
  for (const [board, entries] of boards) {
    console.log(`\n${board}`);
    console.table(entries.map((e) => ({ rank: e.rank, name: e.name, score: e.score, time: time(e.timeMs) })));
  }
  if (d.higher?.entries.length) {
    console.log(`\nhigher (${d.higher.stat})`);
    console.table(
      d.higher.entries.map((e) => ({ rank: e.rank, name: e.name, flawless: e.flawless, correct: e.correct, time: time(e.timeMs) })),
    );
  }
}
