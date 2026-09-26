import { useEffect, useState } from 'preact/hooks';
import {
  DIVISIONS,
  DIVISION_IDS,
  MODES,
  MODE_IDS,
  REGION_LABELS,
  type DivisionId,
  type ModeId,
  type RankedBoardResponse,
  type RankedProfile,
} from '@flagduel/shared';
import { api } from '../api';

const MODE_KEY = 'flagduel.rankedMode';

export function loadRankedMode(): ModeId {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return MODE_IDS.find((x) => x === m) ?? 'flags';
  } catch {
    return 'flags';
  }
}

function storeRankedMode(m: ModeId) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function DivisionBadge({ division, small }: { division: DivisionId; small?: boolean }) {
  return <span class={`division ${division}${small ? ' sm' : ''}`}>{DIVISIONS[division].label}</span>;
}

/** "Europe, South America and North America" */
function regionList(division: DivisionId): string {
  const names = DIVISIONS[division].regions.map((r) => REGION_LABELS[r]);
  if (division === 'diamond') return 'all regions';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What a division adds to the one below: "+ Africa" */
function added(division: DivisionId): string {
  const i = DIVISION_IDS.indexOf(division);
  if (i === 0) return DIVISIONS[division].regions.map((r) => REGION_LABELS[r]).join(', ');
  const below = new Set(DIVISIONS[DIVISION_IDS[i - 1]].regions);
  return '+ ' + DIVISIONS[division].regions.filter((r) => !below.has(r)).map((r) => REGION_LABELS[r]).join(', ');
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span class="elapsed">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

export interface Searching {
  mode: ModeId;
  since: number;
}

/** Ranked 1 vs 1: pick a minigame, see your rating, find a match against a stranger. */
export function RankedCard({
  searching,
  error,
  onFind,
  onCancel,
}: {
  searching: Searching | null;
  error: string | null;
  onFind: (mode: ModeId) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<ModeId>(searching?.mode ?? loadRankedMode());
  const [profile, setProfile] = useState<RankedProfile | null>(null);

  useEffect(() => {
    api.ranked().then(setProfile).catch(() => {});
  }, []);

  const r = profile?.[mode];
  const division = r?.division ?? 'bronze';

  return (
    <section class="card ranked-card">
      <div class="board-head">
        <h2>Ranked</h2>
        <span class="muted small">play a stranger · win or lose rating</span>
      </div>
      <div class="seg" role="tablist" aria-label="Ranked game">
        {MODE_IDS.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={m === mode}
            class={m === mode ? 'on' : ''}
            disabled={!!searching && m !== mode}
            onClick={() => {
              setMode(m);
              storeRankedMode(m);
            }}
          >
            {MODES[m].label}
          </button>
        ))}
      </div>

      <div class="rating-row">
        <DivisionBadge division={division} />
        <div class="rating-main">
          <span class="rating-num">{r ? r.rating : '–'}</span>
          <span class="muted small">
            {r?.provisional ? 'provisional rating · moves fast in your first games' : `${MODES[mode].label} rating`}
          </span>
        </div>
        {r && r.played > 0 && (
          <span class="record small">
            {r.wins}W · {r.losses}L{r.draws ? ` · ${r.draws}D` : ''}
          </span>
        )}
      </div>
      <p class="muted small ranked-regions">
        {DIVISIONS[division].label} plays <strong>{regionList(division)}</strong>. Against a player from a lower
        division, the match uses theirs.
      </p>

      {searching ? (
        <div class="searching" role="status">
          <span class="spinner" aria-hidden="true" />
          <span>
            Looking for an opponent… <Elapsed since={searching.since} />
          </span>
          <button class="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button class="btn btn-primary btn-lg" onClick={() => onFind(mode)}>
          Find match
        </button>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <details class="ladder">
        <summary class="small">Divisions</summary>
        <ul>
          {DIVISION_IDS.map((d) => (
            <li key={d}>
              <DivisionBadge division={d} small />
              <span class="small">{Number.isFinite(DIVISIONS[d].min) ? `${DIVISIONS[d].min}+` : 'start'}</span>
              <span class="muted small">{added(d)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Top ranked players of one minigame. */
export function RankedBoard({ limit = 10 }: { limit?: number }) {
  const [mode, setMode] = useState<ModeId>(loadRankedMode());
  const [data, setData] = useState<RankedBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .rankedBoard(mode)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [mode]);

  const rows = data && data.mode === mode ? data.entries.slice(0, limit) : null;
  const youOutside = data?.you && rows && !rows.some((e) => e.you) ? data.you : null;

  return (
    <section class="card board-card">
      <div class="board-head">
        <h2>Ranked ladder</h2>
        {data && <span class="muted small">{data.players} rated</span>}
      </div>
      <div class="seg" role="tablist" aria-label="Ranked ladder">
        {MODE_IDS.map((m) => (
          <button key={m} role="tab" aria-selected={m === mode} class={m === mode ? 'on' : ''} onClick={() => setMode(m)}>
            {MODES[m].label}
          </button>
        ))}
      </div>
      {error && <p class="form-error">{error}</p>}
      {!rows && !error && <p class="muted center small">Loading…</p>}
      {rows && rows.length === 0 && <p class="muted center small">Nobody is rated yet. Play the first ranked match!</p>}
      {rows && rows.length > 0 && (
        <table class="board">
          <tbody>
            {[...rows, ...(youOutside ? [null, youOutside] : [])].map((e, i) =>
              e === null ? (
                <tr class="gap" key="gap">
                  <td colSpan={4}>⋯</td>
                </tr>
              ) : (
                <tr key={i} class={e.you ? 'you' : ''}>
                  <td class={`rank r${e.rank}`}>{e.rank}</td>
                  <td class="name">
                    {e.name}
                    {e.you && <span class="you-tag">you</span>}
                  </td>
                  <td>
                    <DivisionBadge division={e.division} small />
                  </td>
                  <td class="score">{e.rating}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
