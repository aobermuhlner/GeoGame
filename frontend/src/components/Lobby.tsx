import { useEffect, useState } from 'preact/hooks';
import {
  MIN_POOL_SIZE,
  MODES,
  MODE_IDS,
  REGION_IDS,
  ROUNDS_PER_GAME,
  REGION_LABELS,
  countriesInRegions,
  type ModeId,
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
  onModes: (modes: ModeId[]) => void;
  onLeave: () => void;
}

export function inviteLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?room=${code}`;
}

/** The "Regions" card: world map plus a checklist. Used by the lobby and by practice. */
export function RegionPicker({
  regions,
  countryCount,
  editable,
  hint,
  onToggle,
}: {
  regions: RegionId[];
  countryCount: number;
  editable: boolean;
  hint: string;
  onToggle: (r: RegionId) => void;
}) {
  const poolOk = countryCount >= MIN_POOL_SIZE;
  return (
    <section class="card regions-card">
      <div class="regions-head">
        <h2>Regions</h2>
        <span class={`pool${poolOk ? '' : ' bad'}`}>{countryCount} countries</span>
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

export function Lobby({ room, you, onReady, onStart, onRegions, onModes, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  // Optimistic selection so quick successive clicks build on each other, not on a stale snapshot.
  const [draft, setDraft] = useState<RegionId[] | null>(null);
  const regions = draft ?? room.regions;
  useEffect(() => {
    if (draft && draft.join() === room.regions.join()) setDraft(null);
  }, [room.regions]);
  const [modesDraft, setModesDraft] = useState<ModeId[] | null>(null);
  const modes = modesDraft ?? room.modes;
  useEffect(() => {
    if (modesDraft && modesDraft.join() === room.modes.join()) setModesDraft(null);
  }, [room.modes]);
  const isHost = you === 0;
  const me = room.players[you];
  const full = room.players.length === 2;
  const allReady = full && room.players.every((p) => p.ready && p.connected);
  const countryCount = draft ? countriesInRegions(draft).length : room.countryCount;
  const poolOk = countryCount >= MIN_POOL_SIZE;

  async function copy() {
    const link = inviteLink(room.code);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this link', link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function toggle(r: RegionId) {
    const next = REGION_IDS.filter((x) => (x === r ? !regions.includes(x) : regions.includes(x)));
    if (next.length === 0) return;
    setDraft(next);
    onRegions(next);
  }

  function toggleMode(m: ModeId) {
    const next = MODE_IDS.filter((x) => (x === m ? !modes.includes(x) : modes.includes(x)));
    if (next.length === 0) return;
    setModesDraft(next);
    onModes(next);
  }

  let startHint = '';
  if (!full) startHint = 'Waiting for an opponent to join…';
  else if (!poolOk) startHint = `Pick regions with at least ${MIN_POOL_SIZE} countries.`;
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
          <button class="btn btn-ghost btn-sm" onClick={copy}>
            {copied ? '✓ Link copied' : 'Copy invite link'}
          </button>
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

      <section class="card modes-card">
        <div class="regions-head">
          <h2>Games</h2>
          <span class="pool">
            {modes.length * ROUNDS_PER_GAME} rounds
          </span>
        </div>
        <p class="muted small">
          {isHost
            ? `Pick one or more. Each game is ${ROUNDS_PER_GAME} rounds, played in this order; most points overall wins.`
            : `${room.players[0]?.name ?? 'The host'} picks the games.`}
        </p>
        <div class="mode-list" role="group" aria-label="Games">
          {MODE_IDS.map((m) => {
            const on = modes.includes(m);
            const order = modes.indexOf(m) + 1;
            return (
              <label class={`mode-opt${on ? ' on' : ''}${isHost ? '' : ' locked'}`} key={m}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!isHost || (on && modes.length === 1)}
                  onChange={() => toggleMode(m)}
                />
                <span class="mode-order" aria-hidden="true">
                  {on && modes.length > 1 ? order : ''}
                </span>
                <span class="mode-text">
                  <span class="m-name">{MODES[m].label}</span>
                  <span class="m-desc">{MODES[m].description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <RegionPicker
        regions={regions}
        countryCount={countryCount}
        editable={isHost}
        hint={
          isHost
            ? 'Click a region on the map (or in the list) to leave it out.'
            : `${room.players[0]?.name ?? 'The host'} picks the regions.`
        }
        onToggle={toggle}
      />

      <section class="card actions-card">
        <div class="btn-row">
          <button class={`btn btn-lg ${me.ready ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onReady(!me.ready)}>
            {me.ready ? 'Not ready' : "I'm ready"}
          </button>
          {isHost && (
            <button class="btn btn-lg btn-primary" disabled={!allReady || !poolOk} onClick={onStart}>
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
