import { useEffect, useState } from 'preact/hooks';
import {
  GAME_IDS,
  HIGHER_GAME,
  MAX_GAME_ROUNDS,
  MIN_GAME_ROUNDS,
  MIN_POOL_SIZE,
  MODES,
  REGION_IDS,
  REGION_LABELS,
  countriesInRegions,
  gameLabel,
  isModeId,
  landmarksInRegions,
  poolLabel,
  smallestPool,
  type GameId,
  type RegionId,
  type RoomView,
  type Slot,
} from '@flagduel/shared';
import { Logo } from './common';
import { REGION_COLORS, WorldMap } from './WorldMap';

interface Props {
  room: RoomView;
  you: Slot;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onRegions: (regions: RegionId[]) => void;
  onModes: (modes: GameId[]) => void;
  onRounds: (game: GameId, rounds: number) => void;
  onShuffle: (shuffle: boolean) => void;
  onLeave: () => void;
}

export function inviteLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?room=${code}`;
}

/** "− 10 rounds +" for the host; plain text for the guest. */
function RoundsStepper({
  value,
  label,
  editable,
  onChange,
}: {
  value: number;
  label: string;
  editable: boolean;
  onChange: (rounds: number) => void;
}) {
  const unit = value === 1 ? 'round' : 'rounds';
  if (!editable) return <span class="rounds-fixed">{`${value} ${unit}`}</span>;
  const step = (d: number) => (e: Event) => {
    // Inside the game's <label>: don't toggle its checkbox.
    e.preventDefault();
    e.stopPropagation();
    onChange(Math.min(MAX_GAME_ROUNDS, Math.max(MIN_GAME_ROUNDS, value + d)));
  };
  return (
    <span class="rounds-step" role="group" aria-label={`${label}: rounds`}>
      <button type="button" aria-label={`Fewer ${label} rounds`} disabled={value <= MIN_GAME_ROUNDS} onClick={step(-1)}>
        −
      </button>
      <span class="rounds-val" aria-live="polite">
        <b>{value}</b> {unit}
      </span>
      <button type="button" aria-label={`More ${label} rounds`} disabled={value >= MAX_GAME_ROUNDS} onClick={step(1)}>
        +
      </button>
    </span>
  );
}

/** The "Regions" card: world map plus a checklist. Used by the lobby and by practice. */
export function RegionPicker({
  regions,
  countryCount,
  poolOk = countryCount >= MIN_POOL_SIZE,
  countLabel = `${countryCount} countries`,
  editable,
  hint,
  onToggle,
}: {
  regions: RegionId[];
  countryCount: number;
  /** Enough to play (default: at least MIN_POOL_SIZE countries) */
  poolOk?: boolean;
  /** Pool size shown in the header (default "N countries") */
  countLabel?: string;
  editable: boolean;
  hint: string;
  onToggle: (r: RegionId) => void;
}) {
  return (
    <section class="card regions-card">
      <div class="regions-head">
        <h2>Regions</h2>
        <span class={`pool${poolOk ? '' : ' bad'}`}>{countLabel}</span>
      </div>
      <p class="muted small">{hint}</p>
      <WorldMap selected={regions} editable={editable} onToggle={onToggle} />
      <div class="region-list" role="group" aria-label="Regions">
        {REGION_IDS.map((r) => {
          const on = regions.includes(r);
          return (
            <label class={`region-opt${on ? ' on' : ''}${editable ? '' : ' locked'}`} key={r}>
              <input
                type="checkbox"
                checked={on}
                aria-label={`${REGION_LABELS[r]} (${countriesInRegions([r]).length} countries)`}
                disabled={!editable || (on && regions.length === 1)}
                onChange={() => onToggle(r)}
              />
              <span class="swatch" style={{ background: on ? REGION_COLORS[r] : undefined }} aria-hidden="true" />
              <span class="r-name">{REGION_LABELS[r]}</span>
              <span class="r-count">{countriesInRegions([r]).length}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

/** What the settings cards need from a lobby (1 vs 1 or group). */
interface SettingsRoom {
  regions: RegionId[];
  modes: GameId[];
  roundCounts: Record<GameId, number>;
  countryCount: number;
  shuffle: boolean;
}

/**
 * The host's game and region choices with optimistic drafts, so quick successive clicks build on each other,
 * not on a stale snapshot. Also says whether the pools are big enough to play.
 */
export function useGameSettings(
  room: SettingsRoom,
  onRegions: (regions: RegionId[]) => void,
  onModes: (modes: GameId[]) => void,
  onRounds: (game: GameId, rounds: number) => void,
  onShuffle: (shuffle: boolean) => void,
) {
  const [shuffleDraft, setShuffleDraft] = useState<boolean | null>(null);
  const shuffle = shuffleDraft ?? room.shuffle;
  useEffect(() => {
    if (shuffleDraft === room.shuffle) setShuffleDraft(null);
  }, [room.shuffle]);
  function setShuffle(on: boolean) {
    setShuffleDraft(on);
    onShuffle(on);
  }
  const [draft, setDraft] = useState<RegionId[] | null>(null);
  const regions = draft ?? room.regions;
  useEffect(() => {
    if (draft && draft.join() === room.regions.join()) setDraft(null);
  }, [room.regions]);
  const [modesDraft, setModesDraft] = useState<GameId[] | null>(null);
  const modes = modesDraft ?? room.modes;
  useEffect(() => {
    if (modesDraft && modesDraft.join() === room.modes.join()) setModesDraft(null);
  }, [room.modes]);
  const [countsDraft, setCountsDraft] = useState<Partial<Record<GameId, number>>>({});
  const counts = { ...room.roundCounts, ...countsDraft };
  useEffect(() => {
    const pending = Object.entries(countsDraft).filter(([g, n]) => room.roundCounts[g as GameId] !== n);
    if (pending.length < Object.keys(countsDraft).length) setCountsDraft(Object.fromEntries(pending));
  }, [room.roundCounts]);
  function setRounds(game: GameId, rounds: number) {
    setCountsDraft((d) => ({ ...d, [game]: rounds }));
    onRounds(game, rounds);
  }
  const countryCount = draft ? countriesInRegions(draft).length : room.countryCount;
  // Every selected game needs enough rounds' worth in the selected regions (landmarks run out first);
  // Higher or Lower draws its pairs from the countries.
  const minigames = modes.filter(isModeId);
  const small = minigames.length ? smallestPool(regions, minigames) : null;
  const countriesOk = !modes.includes('higher') || countryCount >= MIN_POOL_SIZE;
  const poolOk = countriesOk && (!small || small.size >= MIN_POOL_SIZE);
  const countLabel =
    `${countryCount} countries` +
    (modes.includes('landmarks') ? ` · ${landmarksInRegions(regions).length} landmarks` : '');
  // A game can't have more rounds than there are items to ask about.
  const totalRounds = modes.reduce(
    (n, g) => n + (isModeId(g) ? Math.min(counts[g], MODES[g].pool(regions).length) : counts[g]),
    0,
  );
  const poolHint = poolOk
    ? ''
    : !countriesOk || !small
      ? `Pick regions with at least ${MIN_POOL_SIZE} countries.`
      : `${MODES[small.mode].label} needs regions with at least ${poolLabel(small.mode, MIN_POOL_SIZE)}.`;

  function toggleRegion(r: RegionId) {
    const next = REGION_IDS.filter((x) => (x === r ? !regions.includes(x) : regions.includes(x)));
    if (next.length === 0) return;
    setDraft(next);
    onRegions(next);
  }

  function toggleMode(m: GameId) {
    const next = GAME_IDS.filter((x) => (x === m ? !modes.includes(x) : modes.includes(x)));
    if (next.length === 0) return;
    setModesDraft(next);
    onModes(next);
  }

  return {
    regions,
    modes,
    counts,
    shuffle,
    countryCount,
    poolOk,
    poolHint,
    countLabel,
    totalRounds,
    toggleRegion,
    toggleMode,
    setRounds,
    setShuffle,
  };
}

/** The "Games" card: which games are played, in order (or shuffled), and how many rounds each. */
export function GamesCard({
  modes,
  counts,
  totalRounds,
  shuffle,
  editable,
  hint,
  onToggle,
  onRounds,
  onShuffle,
}: {
  modes: GameId[];
  counts: Record<GameId, number>;
  totalRounds: number;
  shuffle: boolean;
  editable: boolean;
  hint: string;
  onToggle: (m: GameId) => void;
  onRounds: (game: GameId, rounds: number) => void;
  onShuffle: (shuffle: boolean) => void;
}) {
  return (
    <section class="card modes-card">
      <div class="regions-head">
        <h2>Games</h2>
        <span class="pool">{totalRounds === 1 ? '1 round' : `${totalRounds} rounds`}</span>
      </div>
      <p class="muted small">{hint}</p>
      {modes.length > 1 && (
      <label class={`shuffle-opt${shuffle ? ' on' : ''}${editable ? '' : ' locked'}`}>
        <input
          type="checkbox"
          checked={shuffle}
          disabled={!editable}
          onChange={(e) => onShuffle((e.target as HTMLInputElement).checked)}
        />
        <span class="shuffle-icon" aria-hidden="true">
          🔀
        </span>
        <span class="mode-text">
          <span class="m-name">Random order</span>
          <span class="m-desc">
            The games come in a surprise order, drawn anew every match. You only find out which is next when it starts.
          </span>
        </span>
      </label>
      )}
      <div class="mode-list" role="group" aria-label="Games">
        {GAME_IDS.map((m) => {
          const on = modes.includes(m);
          const order = modes.indexOf(m) + 1;
          return (
            <label class={`mode-opt${on ? ' on' : ''}${editable ? '' : ' locked'}`} key={m}>
              <input
                type="checkbox"
                checked={on}
                disabled={!editable || (on && modes.length === 1)}
                onChange={() => onToggle(m)}
              />
              <span class="mode-order" aria-hidden="true">
                {on && modes.length > 1 ? (shuffle ? '?' : order) : ''}
              </span>
              <span class="mode-text">
                <span class="m-name">{gameLabel(m)}</span>
                <span class="m-desc">{isModeId(m) ? MODES[m].description : HIGHER_GAME.description}</span>
                {on && (
                  <RoundsStepper
                    value={counts[m]}
                    label={gameLabel(m)}
                    editable={editable}
                    onChange={(n) => onRounds(m, n)}
                  />
                )}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

/** "Copy invite link" button that says when it worked. */
export function CopyInvite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const link = inviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this link', link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button class="btn btn-ghost btn-sm" onClick={copy}>
      {copied ? '✓ Link copied' : 'Copy invite link'}
    </button>
  );
}

export function Lobby({ room, you, onReady, onStart, onRegions, onModes, onRounds, onShuffle, onLeave }: Props) {
  const set = useGameSettings(room, onRegions, onModes, onRounds, onShuffle);
  const isHost = you === 0;
  const me = room.players[you];
  const full = room.players.length === 2;
  const allReady = full && room.players.every((p) => p.ready && p.connected);

  let startHint = '';
  if (!full) startHint = 'Waiting for an opponent to join…';
  else if (!set.poolOk) startHint = set.poolHint;
  else if (!allReady) startHint = 'Both players need to be ready.';
  else if (!isHost) startHint = `Waiting for ${room.players[0].name} to start…`;

  return (
    <main class="stack">
      <section class="card lobby-card">
        <header class="brand">
          <Logo />
          <h1>
            Flag <em>Duel</em> lobby
          </h1>
        </header>

        <div class="code-box">
          <span class="code-label">Lobby code</span>
          <span class="code-big" aria-label={`Lobby code ${room.code.split('').join(' ')}`}>
            {room.code}
          </span>
          <CopyInvite code={room.code} />
        </div>

        <ul class="players">
          {[0, 1].map((i) => {
            const p = room.players[i];
            if (!p)
              return (
                <li class="player empty" key={i}>
                  <span class="dot" />
                  <span class="p-name">Waiting for opponent…</span>
                </li>
              );
            return (
              <li class={`player${i === you ? ' is-you' : ''}`} key={i}>
                <span class={`dot${p.connected ? ' on' : ''}`} title={p.connected ? 'Online' : 'Reconnecting…'} />
                <span class="p-name">
                  {p.name}
                  {i === you && <span class="tag">you</span>}
                  {i === 0 && <span class="tag host">host</span>}
                </span>
                <span class={`ready-chip${p.ready ? ' ok' : ''}`}>{p.ready ? '✓ Ready' : 'Not ready'}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <GamesCard
        modes={set.modes}
        counts={set.counts}
        totalRounds={set.totalRounds}
        shuffle={set.shuffle}
        editable={isHost}
        hint={
          isHost
            ? `Pick any mix of games and how many rounds each lasts (${MIN_GAME_ROUNDS}–${MAX_GAME_ROUNDS}). ${set.shuffle ? 'They come in a random order' : "They're played in this order"}; most points overall wins.`
            : `${room.players[0]?.name ?? 'The host'} picks the games.`
        }
        onToggle={set.toggleMode}
        onRounds={set.setRounds}
        onShuffle={set.setShuffle}
      />

      <RegionPicker
        regions={set.regions}
        countryCount={set.countryCount}
        poolOk={set.poolOk}
        countLabel={set.countLabel}
        editable={isHost}
        hint={
          isHost
            ? 'Click a region on the map (or in the list) to leave it out.'
            : `${room.players[0]?.name ?? 'The host'} picks the regions.`
        }
        onToggle={set.toggleRegion}
      />

      <section class="card actions-card">
        <div class="btn-row">
          <button class={`btn btn-lg ${me.ready ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onReady(!me.ready)}>
            {me.ready ? 'Not ready' : "I'm ready"}
          </button>
          {isHost && (
            <button class="btn btn-lg btn-primary" disabled={!allReady || !set.poolOk} onClick={onStart}>
              Start game
            </button>
          )}
        </div>
        {startHint && <p class="muted small center">{startHint}</p>}
        <div class="center">
          <button class="link" onClick={onLeave}>
            Leave lobby
          </button>
        </div>
      </section>
    </main>
  );
}
