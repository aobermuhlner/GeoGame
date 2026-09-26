import { useEffect, useState } from 'preact/hooks';
import {
  MAX_NAME_LENGTH,
  MODE_IDS,
  MODES,
  type DailySummary,
  type MeResponse,
  type RankedProfile,
  type UserView,
} from '@flagduel/shared';
import { api } from '../api';
import { formatDuration } from './common';
import { NextDaily } from './Daily';
import { Leaderboard } from './Leaderboard';
import { DivisionBadge } from './Ranked';
import { Avatar, type Tab } from './NavBar';

function AccountCard({
  user,
  onUser,
  onSignOut,
}: {
  user: UserView;
  onUser: (u: UserView) => void;
  onSignOut: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      onUser(await api.rename(name.trim()));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  return (
    <section class="card account-card">
      <Avatar user={user} size={64} />
      <div class="acc-main">
        {editing ? (
          <form
            class="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save();
            }}
          >
            <input
              class="text-input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              aria-label="Display name"
              autoFocus
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <button class="btn btn-primary btn-sm" type="submit" disabled={!name.trim()}>
              Save
            </button>
            <button
              class="link"
              type="button"
              onClick={() => {
                setEditing(false);
                setName(user.displayName);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <h2 class="acc-name">
            {user.displayName}{' '}
            <button class="link small" onClick={() => setEditing(true)}>
              Edit name
            </button>
          </h2>
        )}
        {error && <p class="form-error">{error}</p>}
        <p class="muted small">
          {user.email ?? (user.guest ? 'Guest account (this browser)' : 'Local dev account')} · member since{' '}
          {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </p>
        <p class="muted small">Your display name is shown on the ranking and to your opponents.</p>
      </div>
      <button class="btn btn-ghost btn-sm" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div class="stat">
      <span class="stat-value">{value}</span>
      <span class="stat-label">{label}</span>
    </div>
  );
}

export function MainLobby({
  user,
  onUser,
  onSignOut,
  onNavigate,
}: {
  user: UserView;
  onUser: (u: UserView) => void;
  onSignOut: () => void;
  onNavigate: (t: Tab) => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [today, setToday] = useState<DailySummary | null>(null);
  const [ranked, setRanked] = useState<RankedProfile | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    api.ranked().then(setRanked).catch(() => {});
    api.dailySummary().then(setToday).catch(() => {});
  }, []);

  const stats = me?.stats;
  const dash = '–';
  const doneToday = today ? MODE_IDS.filter((m) => today.modes[m].status === 'finished').length : 0;

  return (
    <main class="stack">
      <AccountCard user={user} onUser={onUser} onSignOut={onSignOut} />

      <div class="lobby-grid">
        <section class="card play-card">
          <h2>Daily Games</h2>
          <p class="muted small">
            {today
              ? doneToday === MODE_IDS.length
                ? 'All done for today — see you tomorrow!'
                : `${doneToday} of ${MODE_IDS.length} games played today.`
              : 'Loading…'}
          </p>
          <ul class="today-list">
            {MODE_IDS.map((m) => {
              const info = today?.modes[m];
              return (
                <li key={m}>
                  <span>{MODES[m].label}</span>
                  <span class={`today-status ${info?.status ?? ''}`}>
                    {!info ? dash : info.status === 'finished' ? `${info.score} pts${info.timeMs !== null ? ` · ${formatDuration(info.timeMs)}` : ''}` : info.status === 'playing' ? 'in progress' : 'not played'}
                  </span>
                </li>
              );
            })}
          </ul>
          {today && <NextDaily at={today.nextAt} />}
          <button class="btn btn-primary" onClick={() => onNavigate('daily')}>
            {doneToday === MODE_IDS.length ? 'See ranking' : 'Play daily'}
          </button>
        </section>

        <section class="card play-card">
          <h2>Multiplayer</h2>
          <p class="muted small">1 vs 1 in real time: same flag, same moment — the first correct answer wins the point.</p>
          <ul class="today-list">
            <li>
              <span>Ranked</span>
              <span class="today-status">play strangers, climb from Bronze to Diamond</span>
            </li>
            <li>
              <span>Friends</span>
              <span class="today-status">share a 5-letter code</span>
            </li>
          </ul>
          <button class="btn btn-primary" onClick={() => onNavigate('multi')}>
            Play multiplayer
          </button>
        </section>
      </div>

      <section class="card stats-card">
        <h2>Your stats</h2>
        <div class="stats-row">
          <Stat value={stats ? stats.streak : dash} label="day streak" />
          <Stat value={stats ? stats.daysPlayed : dash} label="days played" />
          {MODE_IDS.map((m) => (
            <Stat key={m} value={stats?.daily[m].best ?? dash} label={`best ${MODES[m].label.toLowerCase()}`} />
          ))}
          {MODE_IDS.map((m) => (
            <Stat key={`a${m}`} value={stats?.daily[m].average ?? dash} label={`avg ${MODES[m].label.toLowerCase()}`} />
          ))}
        </div>
        <h3 class="stats-sub">Ranked</h3>
        <div class="stats-row">
          {MODE_IDS.map((m) => {
            const r = ranked?.[m];
            return (
              <div class="stat" key={`r${m}`}>
                <span class="stat-value">{r && !r.locked ? r.rating : dash}</span>
                {r && !r.locked && <DivisionBadge division={r.division} small />}
                <span class="stat-label">
                  {MODES[m].label.toLowerCase()} · {r?.locked ? 'locked' : r && r.played ? `${r.wins}W ${r.losses}L` : 'unplayed'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <Leaderboard limit={5} />
    </main>
  );
}
