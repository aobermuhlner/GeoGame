import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MODES, MODE_IDS, REGION_IDS, ROOM_CODE_RE, type ModeId, type RankedModeId, type RoomView, type Slot } from '@flagduel/shared';
import type { GameActions, GameVM } from './types';
import { api } from './api';
import { Home } from './components/Home';
import { DivisionBadge, RANKED_ENABLED, RankedBoard, RankedCard, type Searching } from './components/Ranked';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';
import { SoloGame, placementSource } from './components/Daily';
import { HigherDuelResults, HigherDuelScreen, type DuelActions } from './components/HigherDuel';
import { GroupPlay } from './components/Group';
import {
  RankedQueue,
  RoomConnection,
  createGroup,
  createRoom,
  flagSrc,
  getSessionId,
  quickGroup,
  roomKind,
  type ConnStatus,
} from './net';

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

// The group lobby this tab is in, so a reload rejoins it.
const LAST_GROUP_KEY = 'flagduel.lastGroup';

function loadLastGroup(): string {
  try {
    return sessionStorage.getItem(LAST_GROUP_KEY) ?? '';
  } catch {
    return '';
  }
}
function storeLastGroup(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(LAST_GROUP_KEY);
    else sessionStorage.setItem(LAST_GROUP_KEY, value);
  } catch {
    /* storage unavailable — a reload then can't rejoin */
  }
}

// Seat ticket of the ranked room this tab is in ({ code, ticket }), so a reload can reclaim the seat.
const TICKET_KEY = 'flagduel.ticket';

function loadTicket(code: string): string | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TICKET_KEY) ?? 'null') as { code: string; ticket: string } | null;
    return t?.code === code ? t.ticket : null;
  } catch {
    return null;
  }
}
function storeTicket(value: { code: string; ticket: string } | null) {
  try {
    if (value === null) sessionStorage.removeItem(TICKET_KEY);
    else sessionStorage.setItem(TICKET_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — a reload then can't rejoin */
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
      locked: x.locked,
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
    shuffle: room.shuffle,
    stage: room.stage,
    stageRound: room.stageRound,
    stageRounds: room.stageRounds,
    prompt: room.prompt,
    flagUrl: room.flag ? flagSrc(room.flag) : null,
    focus: room.focus,
    myLock: room.myLock,
    misses: room.misses ?? null,
    countdownEndsAt: conn.toLocal(room.countdownEndsAt),
    deadline: conn.toLocal(room.deadline),
    regions: room.regions,
    reveal: room.reveal ? { ...room.reveal, flagUrl: flagSrc(room.reveal.flag) } : null,
    oppWrongSeq: o.oppWrongSeq,
    history: room.history.map((h) => ({ ...h, flagUrl: flagSrc(h.flag) })),
    result: room.result,
    forfeitReason: room.forfeitReason,
    ranked: room.ranked,
    higher: room.higher,
  };
}

/**
 * Multiplayer: "Find a game" (a public group game), 1 vs 1 duels and group lobbies with friends. The player's
 * name is their account display name. `onImmersive(true)` while in a room or bot match (the app hides its menu).
 * `quick`: look for a public game right away (the main screen's "Find a game").
 */
export function Multiplayer({
  name,
  onImmersive,
  quick = false,
}: {
  name: string;
  onImmersive: (on: boolean) => void;
  quick?: boolean;
}) {
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') ?? '').toUpperCase();
  const [online, setOnline] = useState<Online | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onlineRef = useRef<Online | null>(null);
  /** Code of the group lobby this tab is in */
  const [group, setGroup] = useState<string | null>(null);

  // Ranked queue
  const [searching, setSearching] = useState<Searching | null>(null);
  const [rankedError, setRankedError] = useState<string | null>(null);
  const queueRef = useRef<RankedQueue | null>(null);
  /** Minigame whose placement test is open */
  const [placement, setPlacement] = useState<RankedModeId | null>(null);
  const placementRun = useMemo(() => (placement ? placementSource(placement) : null), [placement]);

  // Local bot demo (dev only)
  const [demoVm, setDemoVm] = useState<GameVM | null>(null);
  const demoRef = useRef<(GameActions & { dispose(): void }) | null>(null);

  const update = (f: (o: Online) => Online) => {
    if (!onlineRef.current) return;
    onlineRef.current = f(onlineRef.current);
    setOnline(onlineRef.current);
  };

  /** `ticket`: seat ticket of a ranked room (friend lobbies use the tab's session id). */
  function connect(code: string, ticket: string | null = null) {
    onlineRef.current?.conn.stop();
    setError(null);
    storeLastRoom(code);
    storeTicket(ticket ? { code, ticket } : null);
    setRoomInUrl(code);
    const conn: RoomConnection = new RoomConnection(
      code,
      name,
      {
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
      },
      ticket ?? getSessionId(),
    );
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
    storeTicket(null);
    setRoomInUrl(null);
    setOnline(null);
    setError(message);
  }

  function openGroup(code: string) {
    setError(null);
    storeLastGroup(code);
    setRoomInUrl(code);
    setGroup(code);
  }

  function leaveGroup(message: string | null = null) {
    storeLastGroup(null);
    setRoomInUrl(null);
    setGroup(null);
    setError(message);
  }

  async function onQuick() {
    setBusy(true);
    setError(null);
    try {
      openGroup(await quickGroup());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateGroup() {
    setBusy(true);
    setError(null);
    try {
      openGroup(await createGroup());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function findMatch(mode: RankedModeId) {
    const token = api.token();
    if (!token) return setRankedError('Please sign in again.');
    queueRef.current?.stop();
    setRankedError(null);
    setError(null);
    setSearching({ mode, since: Date.now() });
    queueRef.current = new RankedQueue(token, mode, {
      onMatched: (m) => {
        queueRef.current = null;
        setSearching(null);
        connect(m.code, m.ticket);
      },
      onError: (message) => {
        queueRef.current = null;
        setSearching(null);
        setRankedError(message);
      },
    });
  }

  function cancelSearch() {
    queueRef.current?.stop();
    queueRef.current = null;
    setSearching(null);
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
      const kind = await roomKind(code);
      if (!kind) setError(`No lobby with code ${code}.`);
      else if (kind === 'group') openGroup(code);
      else connect(code);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  // Reload with ?room=CODE of the room we were in → rejoin automatically (same session id).
  useEffect(() => {
    if (ROOM_CODE_RE.test(urlRoom) && urlRoom === loadLastRoom()) connect(urlRoom, loadTicket(urlRoom));
    else if (ROOM_CODE_RE.test(urlRoom) && urlRoom === loadLastGroup()) setGroup(urlRoom);
    else if (quick) onQuick();
    return () => {
      // Another menu tab was opened: leave the room for good (a reload doesn't unmount, so it still rejoins).
      queueRef.current?.stop();
      if (onlineRef.current) leave();
      if (loadLastGroup()) {
        storeLastGroup(null);
        setRoomInUrl(null);
      }
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

  /** A group match is past its lobby (GroupPlay reports it). */
  const [groupPlaying, setGroupPlaying] = useState(false);
  // The menu bar stays in lobbies and on result screens; it hides while rounds are played,
  // and once a ranked opponent is found.
  const room = online?.room;
  const immersive =
    (!!demoVm && demoVm.phase !== 'finished') ||
    (!!room && (room.phase !== 'lobby' ? room.phase !== 'finished' : !!room.ranked)) ||
    (!!group && groupPlaying);
  useEffect(() => {
    onImmersive(immersive);
  }, [immersive]);
  useEffect(() => () => onImmersive(false), []);

  const vm = useMemo(() => (online ? toVM(online) : null), [online]);

  const actions: GameActions | null = useMemo(() => {
    if (!online) return null;
    const { conn } = online;
    const ranked = () => onlineRef.current?.room?.ranked ?? null;
    return {
      guess: (text) => conn.guess(onlineRef.current?.room?.round ?? 0, text),
      draft: (text) => conn.send({ t: 'draft', round: onlineRef.current?.room?.round ?? 0, text }),
      pass: () => conn.send({ t: 'pass', round: onlineRef.current?.room?.round ?? 0 }),
      giveUp: () => conn.send({ t: 'giveUp' }),
      // Ranked rooms hold one match: "rematch" searches for a new opponent, "leave" leaves.
      rematch: () => {
        const r = ranked();
        if (!r) return conn.send({ t: 'rematch' });
        leave();
        findMatch(r.mode);
      },
      leave: () => (ranked() ? leave() : conn.send({ t: 'backToLobby' })),
    };
  }, [online?.conn]);

  const duelActions: DuelActions | null = useMemo(() => {
    if (!online) return null;
    const { conn } = online;
    return {
      pick: (code) => conn.send({ t: 'pick', round: onlineRef.current?.room?.round ?? 0, code }),
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

  if (group)
    return (
      <GroupPlay
        key={group}
        code={group}
        name={name}
        onLeave={leaveGroup}
        onPlaying={setGroupPlaying}
        onPlayAgain={onQuick}
      />
    );

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
    const room = online.room;
    // Higher or Lower stages have their own screen; so do the results of a Higher or Lower-only match.
    const duel =
      room.phase !== 'lobby' &&
      !!room.higher &&
      room.players.length === 2 &&
      (room.phase === 'finished' ? room.modes.every((m) => m === 'higher') : room.modes[room.stage] === 'higher');
    return (
      <>
        {banner}
        {toast}
        {duel && duelActions ? (
          room.phase === 'finished' ? (
            <HigherDuelResults room={room} you={online.you} actions={duelActions} />
          ) : (
            <HigherDuelScreen room={room} you={online.you} toLocal={(ms) => c.toLocal(ms)} actions={duelActions} />
          )
        ) : !vm && online.room.ranked ? (
          <MatchFound room={online.room} you={online.you} onCancel={() => leave()} />
        ) : vm && actions ? (
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
            onRounds={(game, rounds) => c.send({ t: 'setRounds', game, rounds })}
            onShuffle={(shuffle) => c.send({ t: 'setShuffle', shuffle })}
            onLeave={() => leave()}
          />
        )}
      </>
    );
  }

  if (placement && placementRun) {
    return (
      <SoloGame
        key={placement}
        mode={placement}
        source={placementRun}
        onExit={() => setPlacement(null)}
        onImmersive={onImmersive}
      />
    );
  }

  return (
    <Home
      name={name}
      initialCode={ROOM_CODE_RE.test(urlRoom) ? urlRoom : ''}
      busy={busy || !!searching}
      error={error}
      onQuick={onQuick}
      onCreate={onCreate}
      onCreateGroup={onCreateGroup}
      onJoin={onJoin}
      onDemo={startDemo}
      ranked={
        RANKED_ENABLED && (
          <RankedCard
            searching={searching}
            error={rankedError}
            onFind={findMatch}
            onCancel={cancelSearch}
            onPlacement={setPlacement}
          />
        )
      }
      below={RANKED_ENABLED && <RankedBoard />}
    />
  );
}

/** Ranked room before the first round: both players are still connecting. */
function MatchFound({ room, you, onCancel }: { room: RoomView; you: Slot; onCancel: () => void }) {
  const ranked = room.ranked!;
  const opp = you === 0 ? 1 : 0;
  return (
    <main class="stack">
      <section class="card center-card match-found">
        <p class="muted small">Ranked {MODES[ranked.mode].label}</p>
        <h2>Opponent found!</h2>
        {room.players[opp] && (
          <p class="vs">
            <strong>{room.players[opp].name}</strong> <DivisionBadge division={ranked.players[opp].division} small />{' '}
            <span class="muted">{ranked.players[opp].rating}</span>
          </p>
        )}
        <p class="muted small">Waiting for both players to connect…</p>
        <button class="link" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </main>
  );
}
