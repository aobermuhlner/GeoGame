import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS,
  LEADERBOARD_SIZE,
  MODE_IDS,
  REGION_IDS,
  cleanName,
  dailyView,
  dayOf,
  newDailyRun,
  nextDayAt,
  pickStages,
  settleRun,
  soloGuess,
  soloNext,
  soloPass,
  type BoardId,
  type DailyGuessResponse,
  type DailyResponse,
  type DailyRun,
  type DailySummary,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type LoginResponse,
  type MeResponse,
  type ModeId,
  type ModeStats,
  type UserView,
} from '@flagduel/shared';
import { FLAGS } from './generated/flags';
import type { GoogleClaims } from './google';

export const SESSION_TTL_MS = 90 * 24 * 3600_000;
/** Guests can't sign back in, so their session is their account. */
export const GUEST_SESSION_TTL_MS = 5 * 365 * 24 * 3600_000;
/** Flag tokens of daily rounds are kept this many days. */
const FLAG_TOKEN_DAYS = 3;

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  picture: string | null;
  created_at: number;
  provider_id: string;
  [k: string]: SqlStorageValue;
}

const toView = (u: UserRow): UserView => ({
  id: u.id,
  displayName: u.display_name,
  email: u.email,
  picture: u.picture,
  createdAt: u.created_at,
  guest: u.provider_id.startsWith('guest:'),
});

function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Competition ranking ("1, 2, 2, 4") over rows already sorted best-first. */
function rank<T extends { score: number }>(rows: T[]): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  rows.forEach((r, i) => out.push({ ...r, rank: i > 0 && rows[i - 1].score === r.score ? out[i - 1].rank : i + 1 }));
  return out;
}

/**
 * All accounts, sessions, daily runs and leaderboards. One instance ("main"),
 * SQLite-backed — plenty for a hobby game; shard by user id if it ever isn't.
 */
export class Accounts extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT,
        picture TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_puzzles (
        date TEXT PRIMARY KEY,
        codes TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_runs (
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        finished_at INTEGER,
        PRIMARY KEY (user_id, date, mode)
      );
      CREATE INDEX IF NOT EXISTS daily_runs_board ON daily_runs (date, mode, score DESC);
      CREATE TABLE IF NOT EXISTS daily_flags (
        token TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        date TEXT NOT NULL
      );
    `);
  }

  // ---------- Accounts & sessions ----------

  async loginGoogle(claims: GoogleClaims, now = Date.now()): Promise<LoginResponse> {
    const name = cleanName(claims.given_name) ?? cleanName(claims.name) ?? cleanName(claims.email?.split('@')[0]) ?? 'Player';
    return this.login(`google:${claims.sub}`, name, claims.email ?? null, claims.picture ?? null, now);
  }

  /** Local development only (the Worker checks DEV_LOGIN): sign in by name. */
  async loginDev(name: string, now = Date.now()): Promise<LoginResponse> {
    return this.login(`dev:${name.toLowerCase()}`, name, null, null, now);
  }

  /** A fresh name-only account; the browser keeps the session token, so it lives as long as that does. */
  async loginGuest(name: string, now = Date.now()): Promise<LoginResponse> {
    return this.login(`guest:${crypto.randomUUID()}`, name, null, null, now, GUEST_SESSION_TTL_MS);
  }

  private async login(
    providerId: string,
    name: string,
    email: string | null,
    picture: string | null,
    now: number,
    ttl = SESSION_TTL_MS,
  ): Promise<LoginResponse> {
    let user = this.sql.exec<UserRow>('SELECT * FROM users WHERE provider_id = ?', providerId).toArray()[0];
    if (user) {
      // Keep the chosen display name; refresh what Google tells us.
      this.sql.exec('UPDATE users SET email = ?, picture = ? WHERE id = ?', email, picture, user.id);
      user = { ...user, email, picture };
    } else {
      user = { id: crypto.randomUUID(), provider_id: providerId, display_name: name, email, picture, created_at: now };
      this.sql.exec(
        'INSERT INTO users (id, provider_id, display_name, email, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        user.id,
        providerId,
        name,
        email,
        picture,
        now,
      );
    }
    const token = randomHex(32);
    this.sql.exec(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      await sha256(token),
      user.id,
      now + ttl,
    );
    this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', now);
    return { token, user: toView(user) };
  }

  /** The signed-in user for a session token, or null. */
  async authenticate(token: string, now = Date.now()): Promise<UserView | null> {
    const row = this.sql
      .exec<UserRow>(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
        await sha256(token),
        now,
      )
      .toArray()[0];
    return row ? toView(row) : null;
  }

  async logout(token: string): Promise<void> {
    this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256(token));
  }

  async setDisplayName(userId: string, name: string): Promise<UserView | null> {
    this.sql.exec('UPDATE users SET display_name = ? WHERE id = ?', name, userId);
    const row = this.sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', userId).toArray()[0];
    return row ? toView(row) : null;
  }

  async me(userId: string, now = Date.now()): Promise<MeResponse | null> {
    const row = this.sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', userId).toArray()[0];
    if (!row) return null;

    const daily = Object.fromEntries(
      MODE_IDS.map((m): [ModeId, ModeStats] => [m, { played: 0, best: null, average: null }]),
    ) as Record<ModeId, ModeStats>;
    for (const r of this.sql.exec<{ mode: string; played: number; best: number; average: number }>(
      `SELECT mode, COUNT(*) AS played, MAX(score) AS best, AVG(score) AS average
       FROM daily_runs WHERE user_id = ? AND finished_at IS NOT NULL GROUP BY mode`,
      userId,
    )) {
      if (r.mode in daily) daily[r.mode as ModeId] = { played: r.played, best: r.best, average: Math.round(r.average) };
    }

    const days = new Set(
      this.sql
        .exec<{ date: string }>('SELECT DISTINCT date FROM daily_runs WHERE user_id = ? AND finished_at IS NOT NULL', userId)
        .toArray()
        .map((r) => r.date),
    );
    let streak = 0;
    let day = now;
    if (!days.has(dayOf(day))) day -= 86_400_000; // today not played yet: the streak is still alive
    while (days.has(dayOf(day))) {
      streak++;
      day -= 86_400_000;
    }
    return { user: toView(row), stats: { daysPlayed: days.size, streak, daily } };
  }

  // ---------- Daily challenge ----------

  /** Today's countries per mode, chosen on the first request of the day. */
  private puzzle(date: string): Record<ModeId, string[]> {
    const row = this.sql.exec<{ codes: string }>('SELECT codes FROM daily_puzzles WHERE date = ?', date).toArray()[0];
    const stored: Partial<Record<ModeId, string[]>> = row ? JSON.parse(row.codes) : {};
    const missing = MODE_IDS.filter((m) => !stored[m]);
    if (!missing.length) return stored as Record<ModeId, string[]>;
    // New day, or a minigame added since today's puzzle was stored: pick countries for the missing modes only.
    const { codes, roundModes } = pickStages(REGION_IDS, missing);
    for (const m of missing) stored[m] = codes.filter((_, i) => roundModes[i] === m);
    this.sql.exec(
      'INSERT INTO daily_puzzles (date, codes) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET codes = excluded.codes',
      date,
      JSON.stringify(stored),
    );
    return stored as Record<ModeId, string[]>;
  }

  private loadRun(userId: string, date: string, mode: ModeId): DailyRun | null {
    const row = this.sql
      .exec<{ state: string }>('SELECT state FROM daily_runs WHERE user_id = ? AND date = ? AND mode = ?', userId, date, mode)
      .toArray()[0];
    return row ? JSON.parse(row.state) : null;
  }

  private saveRun(userId: string, run: DailyRun) {
    this.sql.exec(
      `INSERT INTO daily_runs (user_id, date, mode, state, score, finished_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date, mode) DO UPDATE SET state = excluded.state, score = excluded.score, finished_at = excluded.finished_at`,
      userId,
      run.date,
      run.mode,
      JSON.stringify(run),
      run.score,
      run.finishedAt,
    );
  }

  /** A new flag token for a round that starts at `startsAt`. */
  private flagToken(code: string, startsAt: number, date: string): string {
    const token = randomHex(16);
    this.sql.exec('INSERT INTO daily_flags (token, code, starts_at, date) VALUES (?, ?, ?, ?)', token, code, startsAt, date);
    return token;
  }

  /** Today's run with any timed-out round settled (and saved). */
  private currentRun(userId: string, mode: ModeId, now: number): DailyRun | null {
    const run = this.loadRun(userId, dayOf(now), mode);
    if (run && settleRun(run, now)) this.saveRun(userId, run);
    return run;
  }

  async dailySummary(userId: string, now = Date.now()): Promise<DailySummary> {
    const date = dayOf(now);
    const modes = {} as DailySummary['modes'];
    for (const mode of MODE_IDS) {
      const run = this.currentRun(userId, mode, now);
      modes[mode] = {
        status: !run ? 'new' : run.finishedAt === null ? 'playing' : 'finished',
        score: run?.finishedAt != null ? run.score : null,
        rank: run?.finishedAt != null ? (this.board(date, mode, userId).you?.rank ?? null) : null,
      };
    }
    return { date, nextAt: nextDayAt(now), modes };
  }

  /** Start today's run for `mode`, or resume it. */
  async dailyStart(userId: string, mode: ModeId, now = Date.now()): Promise<DailyResponse> {
    const date = dayOf(now);
    let run = this.currentRun(userId, mode, now);
    if (!run) {
      const codes = this.puzzle(date)[mode];
      run = newDailyRun(date, mode, codes, now, this.flagToken(codes[0], now + COUNTDOWN_MS, date));
      this.saveRun(userId, run);
      const cutoff = dayOf(now - FLAG_TOKEN_DAYS * 86_400_000);
      this.sql.exec('DELETE FROM daily_flags WHERE date < ?', cutoff);
    }
    return { run: dailyView(run, now), now };
  }

  async dailyGet(userId: string, mode: ModeId, now = Date.now()): Promise<DailyResponse | null> {
    const run = this.currentRun(userId, mode, now);
    return run ? { run: dailyView(run, now), now } : null;
  }

  async dailyGuess(userId: string, mode: ModeId, round: number, text: string, now = Date.now()): Promise<DailyGuessResponse | null> {
    const run = this.loadRun(userId, dayOf(now), mode);
    if (!run) return null;
    const outcome = soloGuess(run, round, text, now);
    this.saveRun(userId, run);
    return { outcome, run: dailyView(run, now), now };
  }

  async dailyPass(userId: string, mode: ModeId, round: number, now = Date.now()): Promise<DailyResponse | null> {
    const run = this.loadRun(userId, dayOf(now), mode);
    if (!run) return null;
    soloPass(run, round, now);
    this.saveRun(userId, run);
    return { run: dailyView(run, now), now };
  }

  async dailyNext(userId: string, mode: ModeId, round: number, now = Date.now()): Promise<DailyResponse | null> {
    const run = this.loadRun(userId, dayOf(now), mode);
    if (!run) return null;
    settleRun(run, now);
    const next = run.rounds.length;
    // Same checks as soloNext, so repeated calls don't mint unused flag tokens.
    if (round === next && run.rounds[next - 1].end && next < run.codes.length)
      soloNext(run, round, now, this.flagToken(run.codes[next], now, run.date));
    this.saveRun(userId, run);
    return { run: dailyView(run, now), now };
  }

  /** SVG of a daily round's flag, once that round has started. */
  async dailyFlag(token: string, now = Date.now()): Promise<string | null> {
    const row = this.sql
      .exec<{ code: string }>('SELECT code FROM daily_flags WHERE token = ? AND starts_at <= ?', token, now)
      .toArray()[0];
    return row ? (FLAGS[row.code] ?? null) : null;
  }

  // ---------- Leaderboards ----------

  async leaderboard(userId: string | null, board: BoardId, now = Date.now(), date = dayOf(now)): Promise<LeaderboardResponse> {
    return this.board(date, board, userId);
  }

  private board(date: string, board: BoardId, userId: string | null): LeaderboardResponse {
    const rows =
      board === 'overall'
        ? this.sql
            .exec<{ user_id: string; name: string; score: number }>(
              `SELECT r.user_id, u.display_name AS name, SUM(r.score) AS score FROM daily_runs r
               JOIN users u ON u.id = r.user_id
               WHERE r.date = ? AND r.finished_at IS NOT NULL
               GROUP BY r.user_id ORDER BY score DESC, MAX(r.finished_at) ASC`,
              date,
            )
            .toArray()
        : this.sql
            .exec<{ user_id: string; name: string; score: number }>(
              `SELECT r.user_id, u.display_name AS name, r.score FROM daily_runs r
               JOIN users u ON u.id = r.user_id
               WHERE r.date = ? AND r.mode = ? AND r.finished_at IS NOT NULL
               ORDER BY r.score DESC, r.finished_at ASC`,
              date,
              board,
            )
            .toArray();
    const ranked: LeaderboardEntry[] = rank(rows).map((r) => ({
      rank: r.rank,
      name: r.name,
      score: r.score,
      you: r.user_id === userId,
    }));
    return {
      date,
      board,
      entries: ranked.slice(0, LEADERBOARD_SIZE),
      you: ranked.find((e) => e.you) ?? null,
      players: ranked.length,
    };
  }
}
