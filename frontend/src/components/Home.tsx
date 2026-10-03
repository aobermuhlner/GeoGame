import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { GROUP_MAX_PLAYERS, ROOM_CODE_LENGTH } from '@flagduel/shared';
import { Logo } from './common';
import { QuickCard } from './Quick';

interface Props {
  /** Account display name, used as the in-game name */
  name: string;
  initialCode: string;
  busy: boolean;
  error: string | null;
  /** Find a public game */
  onQuick: () => void;
  /** Create a 1 vs 1 lobby */
  onCreate: () => void;
  /** Create a group lobby (up to 8 players) */
  onCreateGroup: () => void;
  onJoin: (code: string) => void;
  onDemo: () => void;
  /** Ranked card, shown under the header card */
  ranked?: ComponentChildren;
  /** Shown at the bottom */
  below?: ComponentChildren;
}

const NOT_CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function Home({ name, initialCode, busy, error, onQuick, onCreate, onCreateGroup, onJoin, onDemo, ranked, below }: Props) {
  const [code, setCode] = useState(initialCode);
  const codeOk = code.length === ROOM_CODE_LENGTH;

  return (
    <main class="stack home">
      <section class="card home-card home-hero">
        <header class="brand center">
          <Logo size={56} />
          <h1>
            Flag <em>Duel</em>
          </h1>
        </header>
        <p class="tagline">Same flag, same moment. Whoever names it first wins the point.</p>
        <p class="muted small center playing-as">
          Playing as <strong>{name}</strong>
        </p>
      </section>

      <QuickCard busy={busy} onFind={onQuick} />

      {ranked}

      <section class="card home-card friend-card">
        <h2>Play with friends</h2>
        <div class="friend-options">
          <div class="friend-option">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={onCreate}>
              Duel a friend
            </button>
            <p class="muted small">1 vs 1, all about speed: whoever names it first takes the point.</p>
          </div>
          <div class="friend-option">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={onCreateGroup}>
              Group lobby
            </button>
            <p class="muted small">
              Up to {GROUP_MAX_PLAYERS} players, you pick the games. Invite just one friend for a group game for two.
            </p>
          </div>
        </div>
        <form
          class="home-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk) onJoin(code);
          }}
        >
          <div class="or">
            <span>or join with a code</span>
          </div>
          <div class="join-row">
            <input
              class="text-input code-input"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="CODE"
              aria-label="Lobby code"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellcheck={false}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.toUpperCase().replace(NOT_CODE_CHARS, '');
                (e.target as HTMLInputElement).value = v;
                setCode(v);
              }}
            />
            <button type="submit" class="btn btn-ghost" disabled={!codeOk || busy}>
              Join lobby
            </button>
          </div>
        </form>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}

        {import.meta.env.DEV && (
          <div class="demo">
            <button class="link" onClick={onDemo}>
              Practice against a bot (local demo)
            </button>
          </div>
        )}
      </section>

      {below}
    </main>
  );
}
