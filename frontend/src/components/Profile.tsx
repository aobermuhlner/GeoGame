import { useEffect, useState } from 'preact/hooks';
import { MAX_NAME_LENGTH, MODE_IDS, MODES, RANKED_MODE_IDS, type MeResponse, type RankedProfile, type UserView } from '@flagduel/shared';
import { api } from '../api';
import { GoogleButton } from './Login';
import { DivisionBadge, RANKED_ENABLED } from './Ranked';
import { Avatar } from './NavBar';

/** Guests: attach a Google account so the scores and ratings survive sign-out and other devices. */
function LinkGoogle({ onUser }: { onUser: (u: UserView) => void }) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => setClientId(c.googleClientId))
      .catch(() => {});
  }, []);

  if (!clientId) return null;
  return (
    <div class="link-google">
      <p class="small">
        <strong>Keep your progress.</strong> Guest scores live only in this browser. Link a Google account to sign
        in anywhere. If you already have one, this guest's history is added to it.
      </p>
      <GoogleButton
        clientId={clientId}
        onCredential={(c) => {
          setError(null);
          api
            .linkGoogle(c)
            .then(onUser)
            .catch((e: Error) => setError(e.message));
        }}
      />
      {error && <p class="form-error">{error}</p>}
    </div>
  );
}

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
      {user.guest && <LinkGoogle onUser={onUser} />}
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

/** #/profile: the account, and all-time stats of the daily games and ranked. */
export function Profile({
  user,
  onUser,
  onSignOut,
}: {
  user: UserView;
  onUser: (u: UserView) => void;
  onSignOut: () => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ranked, setRanked] = useState<RankedProfile | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    if (RANKED_ENABLED) api.ranked().then(setRanked).catch(() => {});
  }, [user.id]); // linking a guest to an existing Google account switches accounts

  const stats = me?.stats;
  const dash = '–';

  return (
    <main class="stack">
      <AccountCard user={user} onUser={onUser} onSignOut={onSignOut} />

      <section class="card stats-card">
        <h2>Daily games</h2>
        <div class="stats-row">
          <Stat value={stats ? stats.streak : dash} label="day streak" />
          <Stat value={stats ? stats.daysPlayed : dash} label="days played" />
        </div>
        <h3 class="stats-sub">Geo Speed</h3>
        <div class="stats-row">
          {MODE_IDS.map((m) => (
            <Stat key={m} value={stats?.daily[m].best ?? dash} label={`best ${MODES[m].label.toLowerCase()}`} />
          ))}
          {MODE_IDS.map((m) => (
            <Stat key={`a${m}`} value={stats?.daily[m].average ?? dash} label={`avg ${MODES[m].label.toLowerCase()}`} />
          ))}
        </div>
        <h3 class="stats-sub">Geo Knowledge</h3>
        <div class="stats-row">
          <Stat value={stats?.higher.bestFlawless ?? dash} label="best flawless (higher or lower)" />
          <Stat value={stats?.higher.perfect ?? dash} label="perfect runs (higher or lower)" />
          <Stat value={stats?.higher.played ?? dash} label="played (higher or lower)" />
        </div>
      </section>

      {RANKED_ENABLED && (
        <section class="card stats-card">
          <h2>Ranked</h2>
          <div class="stats-row">
            {RANKED_MODE_IDS.map((m) => {
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
      )}
    </main>
  );
}
