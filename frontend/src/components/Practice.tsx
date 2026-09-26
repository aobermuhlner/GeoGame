// Practice: the daily games on demand, one game at a time, random countries from the chosen
// regions. Runs entirely in the browser with the shared solo rules; nothing is sent or saved.
import { useMemo, useState } from 'preact/hooks';
import {
  MIN_POOL_SIZE,
  MODES,
  MODE_IDS,
  REGION_IDS,
  ROUNDS_PER_GAME,
  countriesInRegions,
  dailyView,
  newDailyRun,
  pickFlags,
  settleRun,
  soloGuess,
  soloNext,
  soloPass,
  type DailyRun,
  type ModeId,
  type RegionId,
} from '@flagduel/shared';
import { WORKER_URL } from '../net';
import { SoloGame, type SoloSource } from './Daily';
import { RegionPicker } from './Lobby';

const REGIONS_KEY = 'flagduel.practiceRegions';

function loadRegions(): RegionId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(REGIONS_KEY) ?? 'null') as unknown;
    if (Array.isArray(saved)) {
      const picked = REGION_IDS.filter((r) => saved.includes(r));
      if (picked.length) return picked;
    }
  } catch {
    /* storage unavailable or corrupt — use the default */
  }
  return [...REGION_IDS];
}

function storeRegions(regions: RegionId[]) {
  try {
    localStorage.setItem(REGIONS_KEY, JSON.stringify(regions));
  } catch {
    /* storage unavailable — ignore */
  }
}

const practiceFlagSrc = (code: string) => `${WORKER_URL}/practice/flags/${code}`;

/** A solo run kept in memory; the flag "token" is simply the ISO code. */
export function practiceSource(mode: ModeId, regions: RegionId[]): SoloSource {
  let run: DailyRun | null = null;
  const current = (): DailyRun => {
    if (!run) {
      const codes = pickFlags(regions, ROUNDS_PER_GAME);
      run = newDailyRun('', mode, codes, Date.now(), codes[0]);
    }
    return run;
  };
  const view = (now = Date.now()) => {
    const r = current();
    settleRun(r, now);
    return { run: dailyView(r, now), now };
  };
  return {
    kind: 'practice',
    start: async () => view(),
    get: async () => view(),
    async guess(round, text) {
      const now = Date.now();
      const outcome = soloGuess(current(), round, text, now);
      return { outcome, ...view(now) };
    },
    async pass(round) {
      const now = Date.now();
      soloPass(current(), round, now);
      return view(now);
    },
    async next(round) {
      const now = Date.now();
      const r = current();
      soloNext(r, round, now, r.codes[round] ?? '');
      return view(now);
    },
    flagSrc: practiceFlagSrc,
  };
}

// ---------- Pick a game (#/practice) ----------

function PracticeMenu({ onMode }: { onMode: (m: ModeId) => void }) {
  return (
    <main class="stack">
      <section class="card">
        <h2 class="page-title">Practice</h2>
        <p class="muted small rules">
          Play any game as often as you like — {ROUNDS_PER_GAME} random countries from the regions you pick. Practice
          isn't scored on a ranking and doesn't count towards your stats.
        </p>
        <div class="daily-modes">
          {MODE_IDS.map((m) => (
            <article class="daily-mode" key={m}>
              <div class="dm-text">
                <h3>{MODES[m].label}</h3>
                <p class="muted small">{MODES[m].description}</p>
              </div>
              <button class="btn btn-primary" onClick={() => onMode(m)}>
                Practice
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

// ---------- Settings + game (#/practice/<mode>) ----------

export function Practice({
  mode,
  onMode,
  onImmersive,
}: {
  mode: ModeId | null;
  onMode: (m: ModeId) => void;
  onImmersive: (on: boolean) => void;
}) {
  const [regions, setRegions] = useState<RegionId[]>(loadRegions);
  /** Bumped by Start / Play again: each one is a fresh random run. */
  const [runId, setRunId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const source = useMemo(() => (mode ? practiceSource(mode, regions) : null), [mode, runId]);

  if (!mode) return <PracticeMenu onMode={onMode} />;

  const countryCount = countriesInRegions(regions).length;
  const poolOk = countryCount >= MIN_POOL_SIZE;

  function toggle(r: RegionId) {
    const next = REGION_IDS.filter((x) => (x === r ? !regions.includes(x) : regions.includes(x)));
    if (next.length === 0) return;
    setRegions(next);
    storeRegions(next);
  }

  function start() {
    setRunId((n) => n + 1);
    setPlaying(true);
  }

  if (playing && source) {
    return (
      <SoloGame
        key={runId}
        mode={mode}
        source={source}
        onExit={() => setPlaying(false)}
        onReplay={start}
        onImmersive={onImmersive}
      />
    );
  }

  return (
    <main class="stack">
      <section class="card modes-card">
        <div class="regions-head">
          <h2>Practice · Game</h2>
          <span class="pool">{ROUNDS_PER_GAME} rounds</span>
        </div>
        <p class="muted small">Pick one game. Countries are random every time; scores aren't saved.</p>
        <div class="mode-list" role="radiogroup" aria-label="Game">
          {MODE_IDS.map((m) => (
            <label class={`mode-opt${m === mode ? ' on' : ''}`} key={m}>
              <input type="radio" name="practice-mode" checked={m === mode} onChange={() => onMode(m)} />
              <span class="mode-text">
                <span class="m-name">{MODES[m].label}</span>
                <span class="m-desc">{MODES[m].description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <RegionPicker
        regions={regions}
        countryCount={countryCount}
        editable
        hint="Click a region on the map (or in the list) to leave it out."
        onToggle={toggle}
      />

      <section class="card actions-card">
        <div class="btn-row">
          <button class="btn btn-lg btn-primary" disabled={!poolOk} onClick={start}>
            Start {MODES[mode].label}
          </button>
        </div>
        {!poolOk && <p class="muted small center">Pick regions with at least {MIN_POOL_SIZE} countries.</p>}
      </section>
    </main>
  );
}
