import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MODE_IDS, REGION_IDS, ROOM_CODE_RE, type RoomView, type Slot } from '@flagduel/shared';
import type { GameActions, GameVM } from './types';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';
import { RoomConnection, createRoom, flagSrc, roomExists, type ConnStatus } from './net';

// The current room is remembered per tab.
const LAST_ROOM_KEY = 'flagduel.lastRoom';

function loadLastRoom(): string {
  try {
    return sessionStorage.getItem(LAST_ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}
function storeLastRoom(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(LAST_ROOM_KEY);
    else sessionStorage.setItem(LAST_ROOM_KEY, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

function setRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

interface Online {
  conn: RoomConnection;
  room: RoomView | null;
  you: Slot;
  status: ConnStatus;
  oppWrongSeq: number;
}

/** Map a server snapshot to what the game/results screens render. */
function toVM(o: Online): GameVM | null {
  const { room, conn, you } = o;
  if (!room || room.phase === 'lobby' || room.players.length < 2) return null;
  const player = (i: 0 | 1) => {
    const x = room.players[i];
    return {
      name: x.name,
      score: x.score,
      wrongTotal: x.wrongTotal,
      passed: x.passed,
      connected: x.connected,
      rematch: x.rematch,
      graceEndsAt: conn.toLocal(x.graceEndsAt),
      left: x.left,
    };
  };
  return {
    phase: room.phase,
    me: you,
    players: [player(0), player(1)],
    round: Math.max(1, room.round),
    totalRounds: room.totalRounds,
    modes: room.modes,
    stage: room.stage,
    stageRound: room.stageRound,
    stageRounds: room.stageRounds,
    prompt: room.prompt,
    flagUrl: room.flag ? flagSrc(room.flag) : null,
    countdownEndsAt: conn.toLocal(room.countdownEndsAt),
    deadline: conn.toLocal(room.deadline),
    regions: room.regions,
    reveal: room.reveal
      ? {
          mode: room.reveal.mode,
          code: room.reveal.code,
          countryName: room.reveal.countryName,
          answer: room.reveal.answer,
          winner: room.reveal.winner,
          end: room.reveal.end,
        }
      : null,
    oppWrongSeq: o.oppWrongSeq,
    history: room.history.map((h) => ({ ...h, flagUrl: flagSrc(h.flag) })),
    result: room.result,
    forfeitReason: room.forfeitReason,
  };
}

/**
 * The 1 vs 1 part: create/join screen, lobby, match and results. The player's name is their
 * account display name. `onImmersive(true)` while in a room or bot match (the app hides its menu).
 */
export function Multiplayer({ name, onImmersive }: { name: string; onImmersive: (on: boolean) => void }) {
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') ?? '').toUpperCase();
  const [online, setOnline] = useState<Online | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onlineRef = useRef<Online | null>(null);

  // Local bot demo (dev only)
  const [demoVm, setDemoVm] = useState<GameVM | null>(null);
  const demoRef = useRef<(GameActions & { dispose(): void }) | null>(null);

  const update = (f: (o: Online) => Online) => {
    if (!onlineRef.current) return;
    onlineRef.current = f(onlineRef.current);
    setOnline(onlineRef.current);
  };

  function connect(code: string) {
    onlineRef.current?.conn.stop();
    setError(null);
    storeLastRoom(code);
    setRoomInUrl(code);
    const conn: RoomConnection = new RoomConnection(code, name, {
      onState: (room, you) => update((o) => ({ ...o, room, you })),
      onStatus: (status) => update((o) => ({ ...o, status })),
      onOppWrong: () => update((o) => ({ ...o, oppWrongSeq: o.oppWrongSeq + 1 })),
      onError: (_code, message, fatal) => {
        if (fatal) {
          leave(message);
        } else {
          setError(message);
          setTimeout(() => setError(null), 3000);
        }
      },
    });
    onlineRef.current = { conn, room: null, you: 0, status: 'connecting', oppWrongSeq: 0 };
    setOnline(onlineRef.current);
  }

  function leave(message: string | null = null) {
    const o = onlineRef.current;
    onlineRef.current = null;
    if (o) {
      o.conn.send({ t: 'leave' });
      o.conn.stop();
    }
    storeLastRoom(null);
    setRoomInUrl(null);
    setOnline(null);
    setError(message);
  }

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      connect(await createRoom());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(code: string) {
    setBusy(true);
    setError(null);
    try {
      if (!(await roomExists(code))) setError(`No lobby with code ${code}.`);
      else connect(code);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  // Reload with ?room=CODE of the room we were in → rejoin automatically (same session id).
  useEffect(() => {
    if (ROOM_CODE_RE.test(urlRoom) && urlRoom === loadLastRoom()) connect(urlRoom);
    return () => {
      onlineRef.current?.conn.stop();
      demoRef.current?.dispose();
    };
  }, []);

  async function startDemo() {
    if (!import.meta.env.DEV) return;
    const { startMockGame } = await import('./mock');
    demoRef.current?.dispose();
    // ?modes=locate,flags picks the demo's minigames (default: all)
    const wanted = params.get('modes')?.split(',');
    const picked = MODE_IDS.filter((m) => !wanted || wanted.includes(m));
    // ?regions=europe likewise picks the regions
    const wantedRegions = params.get('regions')?.split(',');
    const pickedRegions = REGION_IDS.filter((r) => !wantedRegions || wantedRegions.includes(r));
    const game = startMockGame({
      name,
      botName: 'Anna',
      regions: pickedRegions.length ? pickedRegions : [...REGION_IDS],
      modes: picked.length ? picked : [...MODE_IDS],
      bot: params.get('bot') === 'lazy' ? 'lazy' : 'normal',
      onUpdate: setDemoVm,
    });
    demoRef.current = {
      ...game,
      leave() {
        game.dispose();
        setDemoVm(null);
      },
    };
  }

  const immersive = !!online || !!demoVm;
  useEffect(() => {
    onImmersive(immersive);
  }, [immersive]);
  useEffect(() => () => onImmersive(false), []);

  const vm = useMemo(() => (online ? toVM(online) : null), [online]);

  const actions: GameActions | null = useMemo(() => {
    if (!online) return null;
    const { conn } = online;
    return {
      guess: (text) => conn.guess(onlineRef.current?.room?.round ?? 0, text),
      pass: () => conn.send({ t: 'pass', round: onlineRef.current?.room?.round ?? 0 }),
      giveUp: () => conn.send({ t: 'giveUp' }),
      rematch: () => conn.send({ t: 'rematch' }),
      leave: () => conn.send({ t: 'backToLobby' }),
    };
  }, [online?.conn]);

  // ---------- render ----------
  if (demoVm && demoRef.current) {
    return demoVm.phase === 'finished' ? (
      <Results vm={demoVm} actions={demoRef.current} />
    ) : (
      <GameScreen vm={demoVm} actions={demoRef.current} />
    );
  }

  if (online) {
    const banner =
      online.status === 'reconnecting' ? (
        <div class="conn-banner" role="status">
          Connection lost — reconnecting…
        </div>
      ) : null;
    const toast = error ? (
      <div class="toast" role="alert">
        {error}
      </div>
    ) : null;

    if (!online.room) {
      return (
        <main class="stack">
          {banner}
          <section class="card center-card">
            <p class="muted">Joining lobby {online.conn.code}…</p>
            <button class="link" onClick={() => leave()}>
              Cancel
            </button>
          </section>
        </main>
      );
    }
    const c = online.conn;
    return (
      <>
        {banner}
        {toast}
        {vm && actions ? (
          vm.phase === 'finished' ? (
            <Results vm={vm} actions={actions} />
          ) : (
            <GameScreen vm={vm} actions={actions} />
          )
        ) : (
          <Lobby
            room={online.room}
            you={online.you}
            onReady={(ready) => c.send({ t: 'ready', ready })}
            onStart={() => c.send({ t: 'start' })}
            onRegions={(regions) => c.send({ t: 'setRegions', regions })}
            onModes={(modes) => c.send({ t: 'setModes', modes })}
            onLeave={() => leave()}
          />
        )}
      </>
    );
  }

  return (
    <Home
      name={name}
      initialCode={ROOM_CODE_RE.test(urlRoom) ? urlRoom : ''}
      busy={busy}
      error={error}
      onCreate={onCreate}
      onJoin={onJoin}
      onDemo={startDemo}
    />
  );
}
