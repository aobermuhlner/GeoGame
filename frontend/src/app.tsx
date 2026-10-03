import { useEffect, useMemo, useState } from 'preact/hooks';
import { MODE_IDS, ROOM_CODE_RE, type ModeId, type UserView } from '@flagduel/shared';
import { api, setSignedOutHandler } from './api';
import { Login } from './components/Login';
import { MainLobby } from './components/MainLobby';
import { Challenges } from './components/Challenges';
import { DailyHub, SoloGame, dailySource } from './components/Daily';
import { HigherGame } from './components/Higher';
import { NavBar, type GameId, type Tab } from './components/NavBar';
import { Practice } from './components/Practice';
import { Profile } from './components/Profile';
import { CreditsLink } from './components/common';
import { Multiplayer } from './multiplayer';

const hashPath = () => location.hash.replace(/^#\/?/, '').split('/');

function tabFromHash(): Tab {
  const [h] = hashPath();
  return h === 'daily' || h === 'multi' || h === 'practice' || h === 'challenges' || h === 'profile' ? h : 'lobby';
}

/** #/daily/<mode> or #/practice/<mode> → that game; #/daily, #/practice → null (the tab's overview) */
function modeFromHash(t: Tab): ModeId | null {
  const [h, m] = hashPath();
  return h === t ? (MODE_IDS.find((x) => x === m) ?? null) : null;
}

/** Daily games also include Higher or Lower (#/daily/higher). */
function dailyFromHash(): GameId | null {
  const [h, m] = hashPath();
  return h === 'daily' && m === 'higher' ? 'higher' : modeFromHash('daily');
}

const urlRoom = () => (new URLSearchParams(location.search).get('room') ?? '').toUpperCase();

export function App() {
  const [user, setUser] = useState<UserView | null>(null);
  const [checking, setChecking] = useState(api.hasSession());
  // An invite link (?room=CODE) opens the multiplayer tab.
  const [tab, setTab] = useState<Tab>(() => (ROOM_CODE_RE.test(urlRoom()) ? 'multi' : tabFromHash()));
  const [dailyMode, setDailyMode] = useState<GameId | null>(dailyFromHash);
  const dailyRun = useMemo(() => (dailyMode && dailyMode !== 'higher' ? dailySource(dailyMode) : null), [dailyMode]);
  const [practiceMode, setPracticeMode] = useState<ModeId | null>(() => modeFromHash('practice'));
  /** In a match or a daily round: hide the menu bar so a stray click can't leave the game. */
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    if (api.hasSession()) {
      api
        .me()
        .then((r) => setUser(r.user))
        .catch(() => {})
        .finally(() => setChecking(false));
    }
    const onHash = () => {
      setTab(tabFromHash());
      setDailyMode(dailyFromHash());
      setPracticeMode(modeFromHash('practice'));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /** `mode` opens that game directly (Daily Games and Practice). */
  function navigate(t: Tab, mode: GameId | null = null) {
    const hash = t === 'lobby' ? '#/' : mode ? `#/${t}/${mode}` : `#/${t}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    setTab(t);
    setDailyMode(t === 'daily' ? mode : null);
    setPracticeMode(t === 'practice' && mode !== 'higher' ? mode : null);
  }

  async function signOut() {
    if (user?.guest && !confirm('Guest accounts can’t sign back in. Sign out and lose this account’s scores?')) return;
    await api.logout();
    setUser(null);
  }

  if (checking) {
    return (
      <main class="stack">
        <section class="card center-card">
          <p class="muted">Loading…</p>
        </section>
      </main>
    );
  }

  if (!user) {
    const room = urlRoom();
    return <Login onSignedIn={setUser} roomCode={ROOM_CODE_RE.test(room) ? room : null} />;
  }

  return (
    <>
      {!immersive && <NavBar tab={tab} user={user} onTab={navigate} />}
      {tab === 'lobby' && <MainLobby user={user} onNavigate={navigate} />}
      {tab === 'profile' && <Profile user={user} onUser={setUser} onSignOut={signOut} />}
      {tab === 'daily' &&
        (dailyMode === 'higher' ? (
          <HigherGame onExit={() => navigate('daily')} onImmersive={setImmersive} />
        ) : dailyMode && dailyRun ? (
          <SoloGame
            key={dailyMode}
            mode={dailyMode}
            source={dailyRun}
            onExit={() => navigate('daily')}
            onImmersive={setImmersive}
          />
        ) : (
          <DailyHub onPlay={(m) => navigate('daily', m)} />
        ))}
      {tab === 'practice' && (
        <Practice
          key={practiceMode ?? 'menu'}
          mode={practiceMode}
          onMode={(m) => navigate('practice', m)}
          onImmersive={setImmersive}
        />
      )}
      {tab === 'challenges' && <Challenges onImmersive={setImmersive} />}
      {tab === 'multi' && <Multiplayer name={user.displayName} onImmersive={setImmersive} />}
      {!immersive && <CreditsLink />}
    </>
  );
}
