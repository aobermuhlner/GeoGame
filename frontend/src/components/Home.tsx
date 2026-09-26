import { useState } from 'preact/hooks';
import { ROOM_CODE_LENGTH } from '@flagduel/shared';
import { Logo } from './common';

interface Props {
  initialName: string;
  initialCode: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onDemo: (name: string) => void;
}

const NOT_CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function Home({ initialName, initialCode, busy, error, onCreate, onJoin, onDemo }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const trimmed = name.trim();
  const nameOk = trimmed.length > 0;
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

        <label class="field">
          <span>Your nickname</span>
          <input
            class="text-input"
            maxLength={16}
            value={name}
            placeholder="e.g. Adrian"
            autoComplete="nickname"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>

        <form
          class="home-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && codeOk) onJoin(trimmed, code);
          }}
        >
          <button
            type="button"
            class="btn btn-primary btn-lg"
            disabled={!nameOk || busy}
            onClick={() => onCreate(trimmed)}
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
            <button type="submit" class="btn btn-ghost" disabled={!nameOk || !codeOk || busy}>
              Join lobby
            </button>
          </div>
          {!nameOk && (code || initialCode) && <p class="muted small center">Enter a nickname first.</p>}
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
        </form>

        {import.meta.env.DEV && (
          <div class="demo">
            <button class="link" disabled={!nameOk} onClick={() => onDemo(trimmed)}>
              Practice against a bot (local demo)
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
