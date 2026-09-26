import { useEffect, useState } from 'preact/hooks';
import { MODES, REGION_IDS, REGION_LABELS, type ModeId, type RegionId } from '@flagduel/shared';

/** Re-renders the caller every `ms` while `active`. Returns Date.now(). */
export function useNow(active: boolean, ms = 200): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="var(--green)" />
      <g fill="none" stroke="#fffdf7" stroke-opacity=".28" stroke-width="1.6">
        <ellipse cx="24" cy="24" rx="9" ry="21" />
        <path d="M3 24h42M6 14h36M6 34h36" />
      </g>
      <path d="M17 11v27" stroke="#fffdf7" stroke-width="3" stroke-linecap="round" />
      <path d="M18.5 12h15l-4 5.5 4 5.5h-15z" fill="#f2c14e" />
    </svg>
  );
}

export function RegionChips({ regions }: { regions: RegionId[] }) {
  const all = regions.length === REGION_IDS.length;
  return (
    <ul class="chips" aria-label="Regions in play">
      {all ? (
        <li class="chip">All regions</li>
      ) : (
        REGION_IDS.filter((r) => regions.includes(r)).map((r) => (
          <li class="chip" key={r}>
            {REGION_LABELS[r]}
          </li>
        ))
      )}
    </ul>
  );
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Total play time: "42.3 s", or "2:05.4" from a minute up. */
export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100)) / 10;
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** "① Flags → ② Capitals" progress through the minigames of a match. */
export function StageSteps({ modes, current }: { modes: ModeId[]; current: number }) {
  return (
    <ol class="stage-steps" aria-label="Games in this match">
      {modes.map((m, i) => (
        <li
          key={m}
          class={i === current ? 'now' : i < current ? 'done' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          <span class="step-num">{i < current ? '✓' : i + 1}</span>
          {MODES[m].label}
        </li>
      ))}
    </ol>
  );
}
