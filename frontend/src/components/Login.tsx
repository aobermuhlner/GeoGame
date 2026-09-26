import { useEffect, useRef, useState } from 'preact/hooks';
import type { AuthConfig, UserView } from '@flagduel/shared';
import { api } from '../api';
import { Logo } from './common';

// Minimal typing for Google Identity Services (https://accounts.google.com/gsi/client)
interface Gsi {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup' }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}
declare global {
  interface Window {
    google?: Gsi;
  }
}

let gsiScript: Promise<Gsi> | null = null;
function loadGsi(): Promise<Gsi> {
  return (gsiScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in unavailable')));
    s.onerror = () => {
      gsiScript = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(s);
  }));
}

function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (c: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadGsi()
      .then((g) => {
        if (!alive || !ref.current) return;
        g.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup' });
        g.accounts.id.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 280,
        });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [clientId]);
  return (
    <>
      <div class="google-btn" ref={ref} />
      {error && <p class="form-error">{error}</p>}
    </>
  );
}

export function Login({ onSignedIn, roomCode }: { onSignedIn: (u: UserView) => void; roomCode: string | null }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devName, setDevName] = useState('');
  const [guestName, setGuestName] = useState('');

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function run(p: Promise<UserView>) {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  const none = config && !config.googleClientId && !config.devLogin && !config.guestLogin;

  return (
    <main class="stack">
      <section class="card home-card login-card">
        <header class="brand center">
          <Logo size={56} />
          <h1>
            Flag <em>Duel</em>
          </h1>
        </header>
        <p class="tagline">
          {roomCode
            ? `Sign in to join lobby ${roomCode}.`
            : 'Daily flag challenges and real-time duels. Pick a name to start playing.'}
        </p>

        <ul class="login-points">
          <li>
            <strong>Daily</strong> one run per game per day, same flags for everyone
          </li>
          <li>
            <strong>Duel</strong> 1 vs 1 with a friend, first correct answer scores
          </li>
          <li>
            <strong>Ranking</strong> climb today's leaderboard
          </li>
        </ul>

        {!config && !error && <p class="muted center">Loading…</p>}
        {config?.guestLogin && (
          <form
            class="dev-login"
            onSubmit={(e) => {
              e.preventDefault();
              if (guestName.trim()) run(api.loginGuest(guestName.trim()));
            }}
          >
            <div class="join-row">
              <input
                class="text-input"
                maxLength={16}
                value={guestName}
                placeholder="Your name"
                aria-label="Your name"
                onInput={(e) => setGuestName((e.target as HTMLInputElement).value)}
              />
              <button class="btn btn-primary" type="submit" disabled={!guestName.trim() || busy}>
                Play
              </button>
            </div>
            <p class="muted center">Your scores are saved in this browser.</p>
          </form>
        )}

        {config?.googleClientId && (
          <GoogleButton clientId={config.googleClientId} onCredential={(c) => run(api.loginGoogle(c))} />
        )}

        {config?.devLogin && (
          <form
            class="dev-login"
            onSubmit={(e) => {
              e.preventDefault();
              if (devName.trim()) run(api.loginDev(devName.trim()));
            }}
          >
            <div class="or">
              <span>local dev sign-in</span>
            </div>
            <div class="join-row">
              <input
                class="text-input"
                maxLength={16}
                value={devName}
                placeholder="Any name"
                aria-label="Dev account name"
                onInput={(e) => setDevName((e.target as HTMLInputElement).value)}
              />
              <button class="btn btn-ghost" type="submit" disabled={!devName.trim() || busy}>
                Sign in
              </button>
            </div>
          </form>
        )}

        {none && <p class="form-error">Sign-in is not configured on the server (GOOGLE_CLIENT_ID).</p>}
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
