import { useState } from 'preact/hooks';
import { Logo } from './common';

interface Props {
  initialName: string;
  initialCode: string;
  onDemo: (name: string) => void;
}

const CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function Home({ initialName, initialCode, onDemo }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const nameOk = name.trim().length > 0;

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

        <div class="home-actions">
          <button class="btn btn-primary btn-lg" disabled title="Multiplayer arrives in milestone 2">
            Create lobby
          </button>
          <div class="join-row">
            <input
              class="text-input code-input"
              value={code}
              maxLength={5}
              placeholder="CODE"
              aria-label="Lobby code"
              autoCapitalize="characters"
              autoComplete="off"
              spellcheck={false}
              onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(CODE_CHARS, ''))}
            />
            <button class="btn btn-ghost" disabled title="Multiplayer arrives in milestone 2">
              Join lobby
            </button>
          </div>
        </div>

        {import.meta.env.DEV && (
          <div class="demo">
            <button class="link" disabled={!nameOk} onClick={() => onDemo(name.trim())}>
              Practice against a bot (local demo)
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
