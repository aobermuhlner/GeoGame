import { useEffect, useState } from 'preact/hooks';
import {
  DIVISIONS,
  DIVISION_IDS,
  MODES,
  MODE_IDS,
  PLACEMENT_BANDS,
  PLACEMENT_PER_GROUP,
  PLACEMENT_ROUNDS,
  COUNTRY_BY_CODE,
  divisionOf,
  type DivisionId,
  type ModeId,
  type RankedBoardResponse,
  type RankedProfile,
} from '@flagduel/shared';
import { api } from '../api';
import { Emblem } from './Emblem';

const MODE_KEY = 'flagduel.rankedMode';

export function loadRankedMode(): ModeId {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return MODE_IDS.find((x) => x === m) ?? 'flags';
  } catch {
    return 'flags';
  }
}

export function storeRankedMode(m: ModeId) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function DivisionBadge({
  division,
  small,
  icon = true,
}: {
  division: DivisionId;
  small?: boolean;
  /** false when a large emblem is already shown next to it */
  icon?: boolean;
}) {
  return (
    <span class={`division ${division}${small ? ' sm' : ''}${icon ? ' has-emblem' : ''}`}>
      {icon && <Emblem division={division} size={small ? 16 : 20} />}
      {DIVISIONS[division].label}
    </span>
  );
}

/** "the 80 best-known countries" */
function countryList(division: DivisionId): string {
  const n = DIVISIONS[division].countries.length;
  return division === 'diamond' ? `all ${n} countries` : `the ${n} best-known countries`;
}

/** What a division adds to the one below: "+ 40 countries: Israel, Nigeria, Sweden …" */
export function added(division: DivisionId): string {
  const { tier } = DIVISIONS[division];
  const names = tier.slice(0, 3).map((c) => COUNTRY_BY_CODE[c]?.name ?? c);
  return `${division === 'bronze' ? '' : '+ '}${tier.length} countries: ${names.join(', ')} …`;
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
  onPlacement,
}: {
  searching: Searching | null;
  error: string | null;
  onFind: (mode: ModeId) => void;
  onCancel: () => void;
  /** Open the placement test of `mode` */
  onPlacement: (mode: ModeId) => void;
}) {
  const [mode, setMode] = useState<ModeId>(searching?.mode ?? loadRankedMode());
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    api.ranked().then(setProfile).catch(() => {});
  }, []);

  const r = profile?.[mode];
  const division = r?.division ?? 'bronze';

  async function startAsBeginner() {
    setUnlocking(true);
    setUnlockError(null);
    try {
      setProfile(await api.rankedBeginner(mode));
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setUnlocking(false);
    }
  }

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

      {r?.locked ? (
        <Unlock
          mode={mode}
          placing={r.placing}
          busy={unlocking}
          error={unlockError}
          onBeginner={startAsBeginner}
          onPlacement={() => onPlacement(mode)}
        />
      ) : (
        <>
          <div class="rating-row">
            <Emblem division={division} size={64} label />
            <div class="rating-main">
              <span class="rating-line">
                <span class="rating-num">{r ? r.rating : '–'}</span>
                <DivisionBadge division={division} small icon={false} />
              </span>
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
            {DIVISIONS[division].label} plays <strong>{countryList(division)}</strong>. Against a player from a lower
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
            <button class="btn btn-primary btn-lg" onClick={() => onFind(mode)} disabled={!r}>
              Find match
            </button>
          )}
        </>
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

/** "1250 · Silver" rows of the placement table: share correct → starting rating. */
function placementRows() {
  return PLACEMENT_BANDS.map((b, i) => ({
    range:
      i === 0
        ? `${Math.round(b.min * 100)}%+`
        : b.min === 0
          ? `under ${Math.round(PLACEMENT_BANDS[i - 1].min * 100)}%`
          : `${Math.round(b.min * 100)}–${Math.round(PLACEMENT_BANDS[i - 1].min * 100) - 1}%`,
    rating: b.rating,
    division: divisionOf(b.rating),
  }));
}

/** Ranked is locked until the player picks a start: Bronze beginner, or the placement test. */
function Unlock({
  mode,
  placing,
  busy,
  error,
  onBeginner,
  onPlacement,
}: {
  mode: ModeId;
  placing: boolean;
  busy: boolean;
  error: string | null;
  onBeginner: () => void;
  onPlacement: () => void;
}) {
  return (
    <div class="unlock">
      <p class="unlock-lead">
        <span class="lock" aria-hidden="true">
          🔒
        </span>{' '}
        Ranked {MODES[mode].label} is locked. Choose how you start:
      </p>
      <div class="unlock-options">
        <div class="unlock-option">
          <h3>Placement test</h3>
          <p class="muted small">
            {PLACEMENT_ROUNDS} countries, from famous to obscure ({PLACEMENT_PER_GROUP} from each division). Your share of correct
            answers sets your starting rating, up to Gold. One try only.
          </p>
          <button class="btn btn-primary" onClick={onPlacement} disabled={busy}>
            {placing ? 'Continue test' : 'Take the test'}
          </button>
        </div>
        <div class="unlock-option">
          <h3>Beginner</h3>
          <p class="muted small">
            Start at {PLACEMENT_BANDS[PLACEMENT_BANDS.length - 1].rating} in <DivisionBadge division="bronze" small />{' '}
            and climb from there.{placing ? ' Abandons your placement test.' : ''}
          </p>
          <button class="btn btn-ghost" onClick={onBeginner} disabled={busy}>
            Start in Bronze
          </button>
        </div>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <details class="ladder">
        <summary class="small">Placement results</summary>
        <ul>
          {placementRows().map((row) => (
            <li key={row.range}>
              <span class="small">{row.range}</span>
              <DivisionBadge division={row.division} small />
              <span class="muted small">{row.rating}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
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
