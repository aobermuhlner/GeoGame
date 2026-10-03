// Group game: up to 8 players, everyone answers every round. Lobby, rounds, standings between games, podium.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  GROUP_BASE_POINTS,
  GROUP_MAX_PLAYERS,
  GROUP_MIN_PLAYERS,
  GROUP_SPEED_POINTS,
  GROUP_STANDINGS_MS,
  HIGHER_GAME,
  MAX_GAME_ROUNDS,
  MIN_GAME_ROUNDS,
  MODES,
  PIN_POINTS,
  answerLabel,
  focusOf,
  gameLabel,
  groupTimeOf,
  isModeId,
  type EntryStatus,
  type GameId,
  type GroupEntryView,
  type GroupView,
  type ModeId,
  type RegionId,
  type StandingView,
} from '@flagduel/shared';
import { connectGroup, groupFlagSrc, type ConnStatus, type RoomConnection } from '../net';
import { CountryInput } from './CountryInput';
import { EstimateLine, NumberInput, QuestionCard, questionOf } from './Guess';
import { FlagImage } from './GameScreen';
import { PairBoard, StatHeader, TimeBar, type PickTag } from './Higher';
import { CopyInvite, GamesCard, RegionPicker, useGameSettings } from './Lobby';
import { LocateBoard } from './LocateBoard';
import { PinBoard } from './PinBoard';
import { PhotoCredit, SentenceCard, ZoomPhoto } from './RoundPrompt';
import { Logo, RegionChips, StageSteps, formatClock, useNow } from './common';

/** One color per seat, for the avatars. */
const SEAT_COLORS = ['#2a6a40', '#d2641a', '#3a6ea5', '#a53a7a', '#8a6d1f', '#5a4fb0', '#1f8a8a', '#b8403a'];

function Avatar({ seat, name, size = 32 }: { seat: number; name: string; size?: number }) {
  return (
    <span
      class="g-avatar"
      style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length], width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px` }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const nameOf = (room: GroupView, seat: number, you: number) => (seat === you ? 'You' : room.players[seat]?.name ?? '?');

/** Seats ordered by the running total (best first) with their rank; exact ties share a rank. */
function liveRanking(room: GroupView): { seat: number; rank: number }[] {
  const cmp = (a: number, b: number) => {
    const x = room.players[a];
    const y = room.players[b];
    return y.score - x.score || y.correct - x.correct || x.timeMs - y.timeMs;
  };
  const order = room.players.map((_, i) => i).sort((a, b) => cmp(a, b) || a - b);
  const out: { seat: number; rank: number }[] = [];
  order.forEach((seat, k) => out.push({ seat, rank: k > 0 && cmp(order[k - 1], seat) === 0 ? out[k - 1].rank : k + 1 }));
  return out;
}

// ---------- Connection ----------

/** A group lobby from joining to the podium. Owns the WebSocket; `onLeave(message)` when the player leaves or the lobby is gone. */
export function GroupPlay({
  code,
  name,
  onLeave,
  onPlaying,
  onPlayAgain,
}: {
  code: string;
  name: string;
  onLeave: (message?: string | null) => void;
  /** Public games: find the next public game (they hold one match each) */
  onPlayAgain: () => void;
  /** True while rounds are played (past the lobby, before the podium) */
  onPlaying: (playing: boolean) => void;
}) {
  const [room, setRoom] = useState<GroupView | null>(null);
  const [you, setYou] = useState(0);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [toast, setToast] = useState<string | null>(null);
  const connRef = useRef<RoomConnection<GroupView, number> | null>(null);

  useEffect(() => {
    const conn = connectGroup(code, name, {
      onState: (r, y) => {
        setRoom(r);
        setYou(y);
      },
      onStatus: setStatus,
      onError: (_code, message, fatal) => {
        if (fatal) onLeave(message);
        else {
          setToast(message);
          setTimeout(() => setToast(null), 3000);
        }
      },
    });
    connRef.current = conn;
    return () => {
      // Unmounted by another menu tab: leave the lobby (a no-op after leave(), which already closed the socket).
      conn.send({ t: 'leave' });
      conn.stop();
    };
  }, [code]);

  const playing = !!room && room.phase !== 'lobby' && room.phase !== 'finished';
  useEffect(() => {
    onPlaying(playing);
  }, [playing]);
  useEffect(() => () => onPlaying(false), []);

  const conn = connRef.current;
  function leave() {
    conn?.send({ t: 'leave' });
    conn?.stop();
    onLeave(null);
  }

  const banner =
    status === 'reconnecting' ? (
      <div class="conn-banner" role="status">
        Connection lost — reconnecting…
      </div>
    ) : null;
  const toastEl = toast ? (
    <div class="toast" role="alert">
      {toast}
    </div>
  ) : null;

  if (!room || !conn) {
    return (
      <main class="stack">
        {banner}
        <section class="card center-card">
          <p class="muted">Joining group lobby {code}…</p>
          <button class="link" onClick={leave}>
            Cancel
          </button>
        </section>
      </main>
    );
  }

  const toLocal = (ms: number | null) => conn.toLocal(ms);
  return (
    <>
      {banner}
      {toastEl}
      {room.phase === 'lobby' ? (
        <GroupLobby
          room={room}
          you={you}
          onStart={() => conn.send({ t: 'start' })}
          onRegions={(regions) => conn.send({ t: 'setRegions', regions })}
          onModes={(modes) => conn.send({ t: 'setModes', modes })}
          onRounds={(game, rounds) => conn.send({ t: 'setRounds', game, rounds })}
          onShuffle={(shuffle) => conn.send({ t: 'setShuffle', shuffle })}
          onLeave={leave}
          toLocal={toLocal}
        />
      ) : room.phase === 'standings' ? (
        <GroupStandings room={room} you={you} toLocal={toLocal} onLeave={leave} />
      ) : room.phase === 'finished' ? (
        <GroupPodium
          room={room}
          you={you}
          onLobby={() => {
            if (!room.public) return conn.send({ t: 'backToLobby' });
            leave();
            onPlayAgain();
          }}
          onLeave={leave}
        />
      ) : (
        <GroupGame
          room={room}
          you={you}
          toLocal={toLocal}
          onGuess={(text) => conn.guess(room.round, text)}
          onDraft={(text) => conn.send({ t: 'draft', round: room.round, text })}
          onPass={() => conn.send({ t: 'pass', round: room.round })}
          onPick={(c) => conn.send({ t: 'pick', round: room.round, code: c })}
          onLeave={leave}
        />
      )}
    </>
  );
}

// ---------- Lobby ----------

function GroupLobby({
  room,
  you,
  onStart,
  onRegions,
  onModes,
  onRounds,
  onShuffle,
  onLeave,
  toLocal,
}: {
  room: GroupView;
  you: number;
  toLocal: (ms: number | null) => number | null;
  onStart: () => void;
  onRegions: (regions: RegionId[]) => void;
  onModes: (modes: GameId[]) => void;
  onRounds: (game: GameId, rounds: number) => void;
  onShuffle: (shuffle: boolean) => void;
  onLeave: () => void;
}) {
  const set = useGameSettings(room, onRegions, onModes, onRounds, onShuffle);
  if (room.public) return <PublicLobby room={room} you={you} toLocal={toLocal} onLeave={onLeave} />;
  const isHost = you === 0;
  const here = room.players.filter((p) => p.connected).length;
  const enough = here >= GROUP_MIN_PLAYERS;
  const host = room.players[0]?.name ?? 'The host';

  let startHint = '';
  if (!enough) startHint = 'Share the code — you need at least one more player.';
  else if (!set.poolOk) startHint = set.poolHint;
  else if (!isHost) startHint = `Waiting for ${host} to start…`;

  return (
    <main class="stack mp-lobby">
      <div class="lobby-col">
        <section class="card lobby-card">
          <header class="brand">
            <Logo />
            <h1>
              Group <em>game</em> lobby
            </h1>
          </header>
          <p class="muted small">
            Everyone answers every round. Right answers score {GROUP_BASE_POINTS} points plus up to {GROUP_SPEED_POINTS}{' '}
            for speed; GeoGuesser estimates score up to 100 the closer they are. After each game you see how the ranking
            changed; the best overall takes the throne.
          </p>

          <div class="code-box">
            <span class="code-label">Lobby code</span>
            <span class="code-big" aria-label={`Lobby code ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
            <CopyInvite code={room.code} />
          </div>

          <div class="regions-head g-players-head">
            <h2>Players</h2>
            <span class="pool">
              {room.players.length}/{room.maxPlayers}
            </span>
          </div>
          <SeatList room={room} you={you} host />
        </section>

        <RegionPicker
          regions={set.regions}
          countryCount={set.countryCount}
          poolOk={set.poolOk}
          countLabel={set.countLabel}
          editable={isHost}
          hint={isHost ? 'Click a region on the map (or in the list) to leave it out.' : `${host} picks the regions.`}
          onToggle={set.toggleRegion}
        />

      </div>
      <div class="lobby-col">
        <GamesCard
          modes={set.modes}
          counts={set.counts}
          totalRounds={set.totalRounds}
          shuffle={set.shuffle}
          editable={isHost}
          hint={
            isHost
              ? `Pick the games and how many rounds each lasts (${MIN_GAME_ROUNDS}–${MAX_GAME_ROUNDS}). ${set.shuffle ? 'They come in a random order.' : "They're played in this order."}`
              : `${host} picks the games.`
          }
          onToggle={set.toggleMode}
          onRounds={set.setRounds}
          onShuffle={set.setShuffle}
        />

        <section class="card actions-card">
          {isHost && (
            <div class="btn-row">
              <button class="btn btn-lg btn-primary" disabled={!enough || !set.poolOk} onClick={onStart}>
                Start game ({here} players)
              </button>
            </div>
          )}
          {startHint && <p class="muted small center">{startHint}</p>}
          <div class="center">
            <button class="link" onClick={onLeave}>
              Leave lobby
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Seat list of a lobby: players, then open seats. */
function SeatList({ room, you, host }: { room: GroupView; you: number; host: boolean }) {
  return (
    <ul class="players g-seats">
      {Array.from({ length: GROUP_MAX_PLAYERS }, (_, i) => {
        const p = room.players[i];
        if (!p)
          return (
            <li class="player empty" key={i}>
              <span class="dot" />
              <span class="p-name">Open seat</span>
            </li>
          );
        return (
          <li class={`player${i === you ? ' is-you' : ''}`} key={i}>
            <Avatar seat={i} name={p.name} size={26} />
            <span class="p-name tagged">
              <span class="p-text">{p.name}</span>
              {i === you && <span class="tag">you</span>}
              {host && i === 0 && <span class="tag host">host</span>}
            </span>
            <span class={`dot${p.connected ? ' on' : ''}`} title={p.connected ? 'Online' : 'Reconnecting…'} />
          </li>
        );
      })}
    </ul>
  );
}

/** "Find a game": nobody hosts. Once two players are in, a minute for more to join, then it starts. */
function PublicLobby({
  room,
  you,
  toLocal,
  onLeave,
}: {
  room: GroupView;
  you: number;
  toLocal: (ms: number | null) => number | null;
  onLeave: () => void;
}) {
  const startsAt = toLocal(room.autoStartAt);
  const now = useNow(startsAt !== null, 250);
  const left = startsAt !== null ? Math.max(0, startsAt - now) : null;
  const rounds = room.totalRounds;
  return (
    <main class="stack mp-lobby quick-lobby">
      <div class="lobby-col">
        <section class="card lobby-card quick-card">
          <header class="brand">
            <Logo />
            <h1>
              Public <em>game</em>
            </h1>
          </header>
          <div class={`quick-clock${left === null ? ' waiting' : ''}`} role="status" aria-live="polite">
            {left === null ? (
              <>
                <span class="qc-kicker">Looking for players</span>
                <strong class="qc-big">
                  <span class="qc-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </strong>
                <span class="muted small">The countdown starts as soon as one more player joins.</span>
              </>
            ) : (
              <>
                <span class="qc-kicker">Starting in</span>
                <strong class="qc-big">{formatClock(left)}</strong>
                <span class="muted small">More players can join until then — up to {room.maxPlayers}.</span>
              </>
            )}
          </div>

          <div class="regions-head g-players-head">
            <h2>Players</h2>
            <span class="pool">
              {room.players.length}/{room.maxPlayers}
            </span>
          </div>
          <SeatList room={room} you={you} host={false} />
          <div class="center">
            <button class="link" onClick={onLeave}>
              Leave
            </button>
          </div>
        </section>
      </div>
      <div class="lobby-col">
        <section class="card quick-info">
          <h2>This game</h2>
          <p class="muted small">
            {room.modes.length} games · {rounds} rounds · the whole world. Everyone answers every round: right answers score{' '}
            {GROUP_BASE_POINTS} points plus up to {GROUP_SPEED_POINTS} for speed.
          </p>
          <ol class="quick-games">
            {room.modes.map((g) => (
              <li key={g}>
                <strong>{gameLabel(g)}</strong>
                <span class="muted small">
                  {g === 'higher' ? 'Pick the country with the higher value.' : MODES[g].description}
                </span>
              </li>
            ))}
          </ol>
          <p class="muted small">Friends can join this game too with the code below.</p>
          <div class="code-box">
            <span class="code-label">Game code</span>
            <span class="code-big" aria-label={`Game code ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
            <CopyInvite code={room.code} />
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------- Rounds ----------

const STATUS_LABEL: Record<EntryStatus, string> = {
  thinking: '',
  correct: '✓',
  locked: '🔒',
  passed: '–',
  out: '✗',
};

/** Everyone at a glance: rank, score and whether they've answered this round (never what). */
function PlayerStrip({ room, you }: { room: GroupView; you: number }) {
  const reveal = room.phase === 'reveal' ? room.reveal : null;
  return (
    <ol class="g-strip" aria-label="Players">
      {liveRanking(room).map(({ seat, rank }) => {
        const p = room.players[seat];
        const st = p.status;
        const gained = reveal?.entries[seat]?.points ?? 0;
        return (
          <li
            key={seat}
            class={`g-chip${seat === you ? ' me' : ''}${p.connected ? '' : ' away'}${st ? ` st-${st}` : ''}`}
            title={`${p.name}: ${p.score} points`}
          >
            <span class="g-rank">{rank}</span>
            <Avatar seat={seat} name={p.name} size={22} />
            <span class="g-name">{seat === you ? 'You' : p.name}</span>
            <span class="g-score">{p.score}</span>
            {reveal && gained > 0 ? (
              <span class="g-gain">+{gained}</span>
            ) : st && room.phase === 'playing' ? (
              <span class={`g-st${st === 'thinking' ? ' g-thinking' : ''}`} aria-label={st === 'thinking' ? 'still answering' : st}>
                {STATUS_LABEL[st]}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** "First up · game 1 of 6 — Flags — 3" before each game. */
function StageIntro({ room, endsAt }: { room: GroupView; endsAt: number }) {
  const now = useNow(true, 100);
  const n = Math.max(1, Math.ceil((endsAt - now) / 1000));
  const game = room.modes[room.stage];
  return (
    <div class="countdown intro">
      <span class="intro-kicker">
        {room.stage === 0 ? 'First up' : 'Next up'} · game {room.stage + 1} of {room.modes.length}
      </span>
      <strong class="intro-title">{gameLabel(game)}</strong>
      <span class="intro-desc">
        {game === 'higher' ? 'Pick the country with the higher value — right and quick scores most.' : MODES[game].description}
      </span>
      <span class="intro-num" key={n}>
        {n}
      </span>
    </div>
  );
}

/** Each player's result of the round that just ended, best first. */
function RoundResults({ room, you }: { room: GroupView; you: number }) {
  const r = room.reveal!;
  if (r.game !== 'higher' && MODES[r.game].accuracy) {
    const order = r.entries
      .map((e, seat) => ({ e, seat }))
      .sort((a, b) => b.e.points - a.e.points || a.seat - b.seat);
    return (
      <ul class="lock-lines g-results estimates">
        {order.map(({ e, seat }) => (
          <EstimateLine key={seat} who={nameOf(room, seat, you)} code={r.code} raw={e.answer} points={e.points} />
        ))}
      </ul>
    );
  }
  const lockIn = r.game === 'higher' || MODES[r.game].lockIn;
  const answerText = (e: GroupEntryView) => {
    if (r.game === 'higher' && e.answer && r.pair) return e.answer === r.pair.a ? r.pair.aName : r.pair.bName;
    if (lockIn) return e.answer ? answerLabel(r.game as ModeId, e.answer, r.code) : e.end === 'passed' ? 'passed' : 'no answer';
    if (e.end === 'correct') return `${(e.timeMs! / 1000).toFixed(1)} s${e.wrong ? ` · ${e.wrong} wrong` : ''}`;
    if (e.end === 'passed') return 'passed';
    if (e.end === 'wrong') return 'out of tries';
    return e.wrong ? `${e.wrong} wrong` : 'no answer';
  };
  const order = r.entries
    .map((e, seat) => ({ e, seat }))
    .sort((a, b) => b.e.points - a.e.points || (a.e.timeMs ?? 1e9) - (b.e.timeMs ?? 1e9) || a.seat - b.seat);
  return (
    <ul class="lock-lines g-results">
      {order.map(({ e, seat }) => (
        <li key={seat} class={`${e.end === 'correct' ? 'ok' : e.end ? 'bad' : 'none'}${seat === you ? ' me' : ''}`}>
          <span class="ll-name">
            <Avatar seat={seat} name={room.players[seat]?.name ?? '?'} size={20} /> {nameOf(room, seat, you)}
          </span>
          <span class="ll-answer">{answerText(e)}</span>
          <span class="ll-mark">{e.end === 'correct' ? '✓' : e.end === 'wrong' ? '✗' : '—'}</span>
          <span class="ll-points">{e.points > 0 ? `+${e.points}` : '0'}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({ room, you }: { room: GroupView; you: number }) {
  const r = room.reveal;
  if (r) {
    const mine = r.entries[you];
    const cls = mine?.end === 'correct' ? 'win' : 'lose';
    const headline =
      r.game === 'higher' && r.pair ? `${r.pair.answer === r.pair.a ? r.pair.aName : r.pair.bName} is higher` : r.answer;
    // GeoGuesser: the question card above shows the answer.
    const estimate = r.game !== 'higher' && !!MODES[r.game].accuracy;
    return (
      <div class={`status-line reveal ${cls}`}>
        {!estimate && <strong class="reveal-country">{headline}</strong>}
        {r.game === 'capitals' && <span class="reveal-of">capital of {r.countryName}</span>}
        {r.game === 'landmarks' && r.detail && <span class="reveal-of">{r.detail}</span>}
        <RoundResults room={room} you={you} />
      </div>
    );
  }
  if (room.phase === 'countdown') return <div class="status-line muted">Get ready…</div>;
  const others = room.players.filter((p, i) => i !== you && p.connected && !p.left);
  const waiting = others.filter((p) => p.status === 'thinking').length;
  const mine = room.mine;
  const game = room.modes[room.stage];
  const lockIn = game === 'higher' || (isModeId(game) && MODES[game].lockIn);
  if (mine?.end) {
    const what =
      mine.end === 'passed'
        ? 'You passed'
        : lockIn
          ? 'Locked in'
          : mine.end === 'correct'
            ? `Right! +${mine.points}`
            : "You're out this round";
    return (
      <div class="status-line muted">
        <span>
          <strong>{what}</strong>
        </span>
        <span>{waiting ? `Waiting for ${waiting === 1 ? '1 player' : `${waiting} players`}…` : 'Revealing…'}</span>
      </div>
    );
  }
  const done = others.length - waiting;
  return (
    <div class="status-line muted hint">
      {done > 0
        ? `${done} of ${others.length} ${others.length === 1 ? 'player has' : 'players have'} answered`
        : isModeId(game) && MODES[game].input === 'pin'
          ? 'Pin it Â· small circle and quick scores most'
          : isModeId(game) && MODES[game].accuracy
            ? 'One estimate each Â· up to 100 points, the closer the more'
          : lockIn
          ? 'One answer · right and quick scores most'
          : 'Everyone answers · the quicker, the more points'}
    </div>
  );
}

function RoundPrompt({ room, mode, toLocal }: { room: GroupView; mode: ModeId; toLocal: (ms: number | null) => number | null }) {
  const m = MODES[mode];
  const r = room.phase === 'reveal' ? room.reveal : null;
  if (m.prompt === 'photo') {
    const token = room.flag ?? r?.flag;
    const focus = room.focus ?? (r ? focusOf(r.code) : null);
    if (!token || !focus) return null;
    const deadline = toLocal(room.deadline);
    const startedAt = deadline !== null ? deadline - groupTimeOf(mode) : null;
    const src = groupFlagSrc(token);
    return <ZoomPhoto key={src} src={src} focus={focus} startedAt={startedAt} full={room.phase !== 'playing'} />;
  }
  if (m.prompt === 'question') return <QuestionCard prompt={room.prompt} code={r?.code ?? null} />;
  if (m.prompt === 'sentence') {
    const text = room.prompt ?? (r ? (m.promptText?.(r.code) ?? null) : null);
    return text ? <SentenceCard text={text} translation={r?.detail} /> : null;
  }
  const token = room.flag ?? r?.flag;
  return token ? <FlagImage src={groupFlagSrc(token)} key={token} /> : null;
}

function GroupTop({ room, you, toLocal }: { room: GroupView; you: number; toLocal: (ms: number | null) => number | null }) {
  const deadline = toLocal(room.deadline);
  const now = useNow(deadline !== null);
  const left = deadline !== null ? deadline - now : null;
  const game = room.modes[room.stage];
  const title = isModeId(game) ? MODES[game].title(room.stageRounds) : `${HIGHER_GAME.label} · ${room.stageRounds} rounds`;
  const done = Math.max(0, room.round - (room.phase === 'reveal' ? 0 : 1));
  return (
    <section class="card top-card">
      <header class="brand">
        <Logo />
        <h1>
          {title} <em>· Everyone Answers</em>
        </h1>
      </header>
      {room.modes.length > 1 && <StageSteps modes={room.modes} current={room.stage} hideAhead={room.shuffle} />}
      <div class="status-row">
        <span class="round-label">
          Round {Math.max(1, room.stageRound)}/{room.stageRounds}
        </span>
        <span class="round-label side">{room.players.length} players</span>
        <span class={`timer${left !== null && left <= 5000 ? ' urgent' : ''}`}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M8 9V6M6 1.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          {left !== null ? formatClock(left) : '–:––'}
        </span>
      </div>
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={room.totalRounds} aria-valuenow={done}>
        <div class="progress-fill" style={{ width: `${(done / Math.max(1, room.totalRounds)) * 100}%` }} />
      </div>
      <PlayerStrip room={room} you={you} />
      <RegionChips regions={room.regions} />
    </section>
  );
}

function LeaveLink({ onLeave }: { onLeave: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div class="give-up">
      {confirm ? (
        <span class="confirm">
          Leave the game? You can't come back.{' '}
          <button class="link danger" onClick={onLeave}>
            Yes, leave
          </button>{' '}
          <button class="link" onClick={() => setConfirm(false)}>
            Keep playing
          </button>
        </span>
      ) : (
        <button class="link danger" onClick={() => setConfirm(true)}>
          Leave game
        </button>
      )}
    </div>
  );
}

function GroupGame({
  room,
  you,
  toLocal,
  onGuess,
  onDraft,
  onPass,
  onPick,
  onLeave,
}: {
  room: GroupView;
  you: number;
  toLocal: (ms: number | null) => number | null;
  onGuess: (text: string) => ReturnType<RoomConnection['guess']>;
  onDraft: (text: string) => void;
  onPass: () => void;
  onPick: (code: string) => void;
  onLeave: () => void;
}) {
  const game = room.modes[room.stage];
  const counting = room.phase === 'countdown';
  const countdownEndsAt = toLocal(room.countdownEndsAt);
  const intro = counting && countdownEndsAt !== null ? <StageIntro room={room} endsAt={countdownEndsAt} /> : null;
  const locked = room.phase !== 'playing' || !!room.mine?.end;
  const passBtn = (
    <div class="give-up">
      <button class="btn btn-sm btn-pass" type="button" disabled={locked} onClick={onPass}>
        Pass
      </button>
    </div>
  );

  if (game === 'higher') {
    const r = room.reveal;
    const pair = room.pair;
    const tags: PickTag[] = r
      ? r.entries.flatMap((e, seat) =>
          e.answer ? [{ code: e.answer, label: nameOf(room, seat, you), kind: seat === you ? ('me' as const) : ('opp' as const) }] : [],
        )
      : [];
    return (
      <main class="stack">
        <GroupTop room={room} you={you} toLocal={toLocal} />
        <section class="card game-card hl-card">
          {intro ? (
            <div class="hl-countdown">{intro}</div>
          ) : pair ? (
            <>
              <StatHeader stat={pair.stat} kicker={`Round ${room.stageRound}`} />
              <PairBoard
                key={room.round}
                pair={pair}
                revealed={r?.pair ? { values: r.pair.values, answer: r.pair.answer } : null}
                mine={r ? (r.entries[you]?.answer ?? null) : (room.mine?.answer ?? null)}
                tags={tags}
                locked={room.phase !== 'playing'}
                onPick={onPick}
              />
            </>
          ) : null}
          <TimeBar deadline={room.phase === 'playing' ? toLocal(room.deadline) : null} total={groupTimeOf('higher')} />
          <StatusLine room={room} you={you} />
          <LeaveLink onLeave={onLeave} />
        </section>
      </main>
    );
  }

  const mode = MODES[game];
  if (mode.input === 'map') {
    return (
      <main class="stack wide">
        <GroupTop room={room} you={you} toLocal={toLocal} />
        <section class="card game-card map-card">
          <LocateBoard
            prompt={counting ? null : (room.prompt ?? room.reveal?.countryName ?? null)}
            flagUrl={counting || !room.flag ? null : groupFlagSrc(room.flag)}
            roundKey={room.round + (counting ? 1000 : 0)}
            locked={locked}
            regions={room.regions}
            answerCode={room.phase === 'reveal' ? (room.reveal?.code ?? null) : null}
            onGuess={onGuess}
            onPass={onPass}
            overlay={intro}
            status={<StatusLine room={room} you={you} />}
            hud={<MapHud room={room} you={you} toLocal={toLocal} />}
          />
          <LeaveLink onLeave={onLeave} />
        </section>
      </main>
    );
  }

  const pin = mode.input === 'pin';
  const reveal = room.phase === 'reveal' ? room.reveal : null;

  return (
    <main class={`stack${pin ? ' wide' : ''}`}>
      <GroupTop room={room} you={you} toLocal={toLocal} />
      <section class="card game-card">
        <div class="round-badge" aria-label={`Round ${Math.max(1, room.stageRound)}`}>
          {Math.max(1, room.stageRound)}
        </div>
        <div class={`flag-frame ${mode.prompt}-prompt`}>
          {intro ?? <RoundPrompt room={room} mode={game} toLocal={toLocal} />}
        </div>
        {room.prompt && room.phase === 'playing' && mode.prompt === 'flag' && (
          <p class="prompt">
            Capital of <strong>{room.prompt}</strong>?
          </p>
        )}
        <StatusLine room={room} you={you} />
        {pin ? (
          <PinBoard
            roundKey={room.round}
            locked={locked}
            onLock={onGuess}
            onDraft={onDraft}
            mine={room.mine?.answer ?? null}
            regions={room.regions}
            worth={(i) => `${PIN_POINTS[i] * 20}%`}
            reveal={
              reveal?.game === 'landmarks'
                ? {
                    landmark: reveal.code,
                    pins: reveal.entries.flatMap((e, seat) =>
                      e.answer
                        ? [{ answer: e.answer, correct: e.end === 'correct', me: seat === you, label: nameOf(room, seat, you) }]
                        : [],
                    ),
                  }
                : null
            }
          />
        ) : mode.input === 'number' ? (
          <NumberInput
            quantity={questionOf(room.prompt, room.reveal?.code ?? null)?.quantity ?? null}
            locked={locked}
            focusKey={room.round}
            onSubmit={onGuess}
          />
        ) : (
          <div class="guess-row">
            <CountryInput
              locked={locked}
              focusKey={room.round}
              onSubmit={onGuess}
              suggest={mode.suggest}
              placeholder={mode.placeholder}
              submitLabel={mode.lockIn ? 'Lock in' : undefined}
            />
          </div>
        )}
        {reveal?.game === 'landmarks' && <PhotoCredit id={reveal.code} />}
        {passBtn}
        <LeaveLink onLeave={onLeave} />
      </section>
    </main>
  );
}

function MapHud({ room, you, toLocal }: { room: GroupView; you: number; toLocal: (ms: number | null) => number | null }) {
  const deadline = toLocal(room.deadline);
  const now = useNow(deadline !== null);
  const left = deadline !== null ? deadline - now : null;
  const me = liveRanking(room).find((x) => x.seat === you);
  return (
    <>
      <span>
        {Math.max(1, room.stageRound)}/{room.stageRounds}
      </span>
      <span>
        #{me?.rank ?? '–'} · {room.players[you]?.score ?? 0} pts
      </span>
      <span class={left !== null && left <= 5000 ? 'urgent' : ''}>{left !== null ? formatClock(left) : '–:––'}</span>
    </>
  );
}

// ---------- Standings between games ----------

/** Row height + gap of the standings list (the rows slide by whole rows). */
const ROW_PX = 58;

/** Counts from `from` to `to` once `go` turns true. */
function CountTo({ from, to, go }: { from: number; to: number; go: boolean }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (!go || from === to) return setV(go ? to : from);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(to);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 800);
      setV(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [go, from, to]);
  return <>{v}</>;
}

function Movement({ s }: { s: StandingView }) {
  if (s.prevRank === null) return <span class="g-move none" />;
  const d = s.prevRank - s.rank;
  if (d > 0)
    return (
      <span class="g-move up" aria-label={`up ${d}`}>
        ▲{d}
      </span>
    );
  if (d < 0)
    return (
      <span class="g-move down" aria-label={`down ${-d}`}>
        ▼{-d}
      </span>
    );
  return (
    <span class="g-move same" aria-label="no change">
      –
    </span>
  );
}

/**
 * The ranking after a game: rows start in the old order with the old totals, the points of the game pop in and
 * count up, then the rows slide to their new places with ▲/▼. Moves on by itself.
 */
function GroupStandings({
  room,
  you,
  toLocal,
  onLeave,
}: {
  room: GroupView;
  you: number;
  toLocal: (ms: number | null) => number | null;
  onLeave: () => void;
}) {
  const st = room.standings ?? [];
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const a = setTimeout(() => setStep(1), 700);
    const b = setTimeout(() => setStep(2), 1900);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [room.stage]);
  const endsAt = toLocal(room.standingsEndsAt);
  const now = useNow(endsAt !== null, 250);
  const secs = endsAt !== null ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const last = room.stage >= room.modes.length - 1;
  const next = last ? null : room.modes[room.stage + 1];
  // Old order: by the rank before this game (first game: already the new order, nothing moves).
  const oldOrder = [...st].sort((a, b) => (a.prevRank ?? a.rank) - (b.prevRank ?? b.rank) || a.player - b.player);
  const oldIndex = new Map(oldOrder.map((s, i) => [s.player, i]));
  const moved = step >= 2;
  const leader = st[0];

  return (
    <main class="stack">
      <section class="card g-standings">
        <header class="g-standings-head">
          <span class="intro-kicker">
            {gameLabel(room.modes[room.stage])} done · game {room.stage + 1} of {room.modes.length}
          </span>
          <h1>{last ? 'Final standings' : 'Standings'}</h1>
          {leader && moved && (
            <p class="muted small">
              {leader.player === you ? 'You lead' : `${room.players[leader.player]?.name} leads`} with {leader.score} points
            </p>
          )}
        </header>
        <ol class="g-table" style={{ height: `${st.length * ROW_PX}px` }}>
          {st.map((s, newIndex) => {
            const from = oldIndex.get(s.player) ?? newIndex;
            const y = (moved ? newIndex : from) * ROW_PX;
            const p = room.players[s.player];
            return (
              <li
                key={s.player}
                class={`g-row${s.player === you ? ' me' : ''}${moved && s.prevRank !== null && s.prevRank > s.rank ? ' rose' : ''}${
                  moved && s.prevRank !== null && s.prevRank < s.rank ? ' fell' : ''
                }${p?.left ? ' away' : ''}`}
                style={{ transform: `translateY(${y}px)` }}
              >
                <span class="g-pos">{moved ? s.rank : (s.prevRank ?? s.rank)}</span>
                <Avatar seat={s.player} name={p?.name ?? '?'} />
                <span class="g-rname">
                  {p?.name ?? '?'}
                  {s.player === you && <span class="tag">you</span>}
                </span>
                <span class={`g-gained${step >= 1 ? ' in' : ''}${s.gained ? '' : ' zero'}`}>+{s.gained}</span>
                <span class="g-total">
                  <CountTo from={s.score - s.gained} to={s.score} go={step >= 1} />
                </span>
                <span class={`g-move-wrap${moved ? ' in' : ''}`}>
                  <Movement s={s} />
                </span>
              </li>
            );
          })}
        </ol>
        <div class="g-next">
          <div class="g-next-bar">
            <div
              class="g-next-fill"
              style={{ width: `${endsAt !== null ? Math.max(0, Math.min(100, ((endsAt - now) / GROUP_STANDINGS_MS) * 100)) : 0}%` }}
            />
          </div>
          <span class="muted small">
            {next
              ? room.shuffle
                ? `Next game in ${secs} s — which one is a surprise`
                : `Next up: ${gameLabel(next)} in ${secs} s`
              : `And the winner is… ${secs} s`}
          </span>
        </div>
        <LeaveLink onLeave={onLeave} />
      </section>
    </main>
  );
}

// ---------- Podium ----------

const MEDALS = ['gold', 'silver', 'bronze'] as const;

function GroupPodium({
  room,
  you,
  onLobby,
  onLeave,
}: {
  room: GroupView;
  you: number;
  onLobby: () => void;
  onLeave: () => void;
}) {
  const st = room.standings ?? [];
  const top = st.slice(0, 3);
  const rest = st.slice(3);
  const mine = st.find((s) => s.player === you);
  // Podium order on screen: silver, gold, bronze.
  const onStage = [top[1], top[0], top[2]].filter(Boolean) as StandingView[];
  const place = (s: StandingView) => Math.min(2, top.indexOf(s));

  return (
    <main class="stack">
      <section class="card g-podium-card">
        <span class="intro-kicker">
          {room.public ? 'Public game' : 'Group game'} · {room.players.length} players
        </span>
        <h1 class="g-podium-title">
          {mine?.rank === 1 ? 'You take the throne!' : `${room.players[st[0]?.player]?.name ?? '?'} takes the throne!`}
        </h1>
        {mine && mine.rank > 1 && <p class="muted">You finished #{mine.rank} with {mine.score} points.</p>}
        <div class="g-podium">
          {onStage.map((s) => {
            const k = place(s);
            const p = room.players[s.player];
            return (
              <div key={s.player} class={`g-step ${MEDALS[k]}${s.player === you ? ' me' : ''}`}>
                {k === 0 && (
                  <span class="g-crown" aria-hidden="true">
                    👑
                  </span>
                )}
                <Avatar seat={s.player} name={p?.name ?? '?'} size={k === 0 ? 64 : 50} />
                <span class="g-step-name">{s.player === you ? `${p?.name} (you)` : p?.name}</span>
                <span class="g-step-score">{s.score} pts</span>
                <div class="g-block">
                  <span class="g-block-num">{s.rank}</span>
                </div>
              </div>
            );
          })}
        </div>
        {rest.length > 0 && (
          <ol class="g-rest">
            {rest.map((s) => (
              <li key={s.player} class={s.player === you ? 'me' : ''}>
                <span class="g-pos">{s.rank}</span>
                <Avatar seat={s.player} name={room.players[s.player]?.name ?? '?'} size={24} />
                <span class="g-rname">{room.players[s.player]?.name}</span>
                <span class="g-total">{s.score}</span>
              </li>
            ))}
          </ol>
        )}
        <div class="btn-row">
          <button class="btn btn-primary" onClick={onLobby}>
            {room.public ? 'Play again' : 'Back to lobby'}
          </button>
          <button class="btn btn-ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </section>

      <section class="card rounds-card">
        <h2>Ranking</h2>
        <div class="g-scroll">
          <table class="rounds g-final">
            <thead>
              <tr>
                <th>#</th>
                <th class="left">Player</th>
                {room.modes.map((m) => (
                  <th key={m}>{gameLabel(m)}</th>
                ))}
                <th>Right</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {st.map((s) => {
                const p = room.players[s.player];
                return (
                  <tr key={s.player} class={s.player === you ? 'g-me' : ''}>
                    <td class="num">{s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] : s.rank}</td>
                    <td class="left">
                      {p?.name}
                      {p?.left && <span class="of-country">left</span>}
                    </td>
                    {room.modes.map((m, k) => (
                      <td key={m}>{room.stageScores[s.player]?.[k] ?? '–'}</td>
                    ))}
                    <td>{p?.correct ?? 0}</td>
                    <td class="lead">{s.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
