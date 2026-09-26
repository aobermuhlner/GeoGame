import { useState } from 'preact/hooks';
import { ROOM_CODE_LENGTH } from '@flagduel/shared';
import { Logo } from './common';

interface Props {
  /** Account display name, used as the in-game name */
  name: string;
  initialCode: string;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onDemo: () => void;
}

const NOT_CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function Home({ name, initialCode, busy, error, onCreate, onJoin, onDemo }: Props) {
  const [code, setCode] = useState(initialCode);
  const codeOk = code.length === ROOM_CODE_LENGTH;

  return (
    <main class="stack">
      <section class="card home-card">
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

        <form
          class="home-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk) onJoin(code);
          }}
        >
          <button
            type="button"
            class="btn btn-primary btn-lg"
            disabled={busy}
            onClick={onCreate}
          >
            Create lobby
          </button>
          <div class="or">
            <span>or join a friend</span>
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
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
        </form>

        {import.meta.env.DEV && (
          <div class="demo">
            <button class="link" onClick={onDemo}>
              Practice against a bot (local demo)
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
