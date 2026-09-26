import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { REGION_IDS, ROOM_CODE_RE, type RoomView, type Slot } from '@flagduel/shared';
import type { GameActions, GameVM } from './types';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';
import { RoomConnection, createRoom, flagSrc, roomExists, type ConnStatus } from './net';

const NAME_KEY = 'flagduel.name';
const LAST_ROOM_KEY = 'flagduel.lastRoom';

// The nickname is remembered per browser; the current room per tab.
const storageFor = (key: string) => (key === LAST_ROOM_KEY ? sessionStorage : localStorage);

function load(key: string): string {
  try {
    return storageFor(key).getItem(key) ?? '';
  } catch {
    return '';
  }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) storageFor(key).removeItem(key);
    else storageFor(key).setItem(key, value);
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
  const p = room.players;
  return {
    phase: room.phase,
    me: you,
    players: [
      { name: p[0].name, score: p[0].score, wrongTotal: p[0].wrongTotal, passed: p[0].passed, connected: p[0].connected },
      { name: p[1].name, score: p[1].score, wrongTotal: p[1].wrongTotal, passed: p[1].passed, connected: p[1].connected },
    ],
    round: Math.max(1, room.round),
    totalRounds: room.totalRounds,
    flagUrl: room.flag ? flagSrc(room.flag) : null,
    countdownEndsAt: conn.toLocal(room.countdownEndsAt),
    deadline: conn.toLocal(room.deadline),
    regions: room.regions,
    reveal: room.reveal ? { countryName: room.reveal.countryName, winner: room.reveal.winner, end: room.reveal.end } : null,
    oppWrongSeq: o.oppWrongSeq,
    history: room.history.map((h) => ({ ...h, flagUrl: flagSrc(h.flag) })),
    result: room.result,
  };
}

export function App() {
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

  function connect(code: string, name: string) {
    onlineRef.current?.conn.stop();
    setError(null);
    store(NAME_KEY, name);
    store(LAST_ROOM_KEY, code);
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
    store(LAST_ROOM_KEY, null);
    setRoomInUrl(null);
    setOnline(null);
    setError(message);
  }

  async function onCreate(name: string) {
    setBusy(true);
    setError(null);
    try {
      connect(await createRoom(), name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(name: string, code: string) {
    setBusy(true);
    setError(null);
    try {
      if (!(await roomExists(code))) setError(`No lobby with code ${code}.`);
      else connect(code, name);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  // Reload with ?room=CODE of the room we were in → rejoin automatically (same session id).
  useEffect(() => {
    const name = load(NAME_KEY);
    if (ROOM_CODE_RE.test(urlRoom) && urlRoom === load(LAST_ROOM_KEY) && name) connect(urlRoom, name);
    return () => {
      onlineRef.current?.conn.stop();
      demoRef.current?.dispose();
    };
  }, []);

  async function startDemo(name: string) {
    store(NAME_KEY, name);
    if (!import.meta.env.DEV) return;
    const { startMockGame } = await import('./mock');
    demoRef.current?.dispose();
    const game = startMockGame({
      name,
      botName: 'Anna',
      regions: [...REGION_IDS],
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
            onLeave={() => leave()}
          />
        )}
      </>
    );
  }

  return (
    <Home
      initialName={load(NAME_KEY)}
      initialCode={ROOM_CODE_RE.test(urlRoom) ? urlRoom : ''}
      busy={busy}
      error={error}
      onCreate={onCreate}
      onJoin={onJoin}
      onDemo={startDemo}
    />
  );
}
