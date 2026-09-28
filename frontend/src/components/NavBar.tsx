import { useState } from 'preact/hooks';
import { MODES, MODE_IDS, type ModeId, type UserView } from '@flagduel/shared';
import { Logo } from './common';
import { HIGHER_DESC, HIGHER_LABEL } from './Higher';

export type Tab = 'lobby' | 'daily' | 'practice' | 'multi' | 'profile';
/** A flag game, or Higher or Lower (daily only) */
export type GameId = ModeId | 'higher';

/** `menu`: hovering lists the games, each linking straight to that game. */
const TABS: { id: Tab; label: string; menu?: true }[] = [
  { id: 'lobby', label: 'Lobby' },
  { id: 'daily', label: 'Daily Games', menu: true },
  { id: 'practice', label: 'Practice', menu: true },
  { id: 'multi', label: 'Multiplayer' },
];

export function Avatar({ user, size = 32 }: { user: UserView; size?: number }) {
  return user.picture ? (
    <img class="avatar" src={user.picture} alt="" width={size} height={size} referrerpolicy="no-referrer" />
  ) : (
    <span class="avatar initial" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px` }}>
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function NavBar({
  tab,
  user,
  onTab,
}: {
  tab: Tab;
  user: UserView;
  onTab: (t: Tab, mode?: GameId | null) => void;
}) {
  // Picking a game closes its hover menu until the pointer leaves it.
  const [shut, setShut] = useState<Tab | null>(null);
  return (
    <nav class="navbar" aria-label="Main">
      <a
        class="nav-brand"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          onTab('lobby');
        }}
      >
        <Logo size={30} />
        <span>
          Flag <em>Duel</em>
        </span>
      </a>
      <ul class="nav-tabs">
        {TABS.map((t) => (
          <li
            key={t.id}
            class={t.menu ? `nav-drop${shut === t.id ? ' shut' : ''}` : undefined}
            onMouseLeave={t.menu ? () => setShut(null) : undefined}
          >
            <a
              href={t.id === 'lobby' ? '#/' : `#/${t.id}`}
              class={tab === t.id ? 'on' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onTab(t.id);
              }}
            >
              {t.label}
              {t.menu && (
                <svg class="nav-caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              )}
            </a>
            {t.menu && (
              <ul class="nav-sub" aria-label={`${t.label}: pick a game`}>
                {[...MODE_IDS, ...(t.id === 'daily' ? (['higher'] as const) : [])].map((m) => (
                  <li key={m}>
                    <a
                      href={`#/${t.id}/${m}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setShut(t.id);
                        (e.currentTarget as HTMLElement).blur();
                        onTab(t.id, m);
                      }}
                    >
                      <span class="m-name">
                        {t.id === 'daily' ? 'Daily ' : ''}
                        {m === 'higher' ? HIGHER_LABEL : MODES[m].label}
                      </span>
                      <span class="m-desc">{m === 'higher' ? HIGHER_DESC : MODES[m].description}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <button
        class={`nav-user${tab === 'profile' ? ' on' : ''}`}
        title="Your profile and stats"
        aria-current={tab === 'profile' ? 'page' : undefined}
        onClick={() => onTab('profile')}
      >
        <Avatar user={user} size={30} />
        <span class="nav-name">{user.displayName}</span>
      </button>
    </nav>
  );
}
