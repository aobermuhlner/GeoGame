import { useEffect, useRef } from 'preact/hooks';
import { COUNTDOWN_MS, DIVISIONS, MODES, type RankedPlayerView } from '@flagduel/shared';
import type { GameVM } from '../types';
import { Emblem } from './Emblem';
import { gamesSummary, useNow } from './common';

/** How long before the intro ends it starts fading into the countdown */
const FADE_MS = 400;

/** What the intro needs from a match (flag games pass their GameVM). */
type IntroVM = Pick<GameVM, 'countdownEndsAt' | 'me' | 'modes' | 'shuffle' | 'ranked'> & {
  phase: string;
  history: readonly unknown[];
  players: readonly { name: string }[];
};

/**
 * Full-screen "You vs Opponent" intro at the start of a match, shown while the server's first
 * countdown still has more than COUNTDOWN_MS left. Ranked matches show both emblems and ratings.
 */
export function VsIntro({ vm, label }: { vm: IntroVM; label?: string }) {
  const active = vm.phase === 'countdown' && vm.history.length === 0 && vm.countdownEndsAt !== null;
  const now = useNow(active, 100);
  if (!active) return null;
  const left = vm.countdownEndsAt! - now - COUNTDOWN_MS;
  if (left <= 0) return null;

  const oppSlot = vm.me === 0 ? 1 : 0;
  const me = vm.players[vm.me];
  const opp = vm.players[oppSlot];
  const ranked = vm.ranked ?? null;
  const modes = gamesSummary(vm.modes, vm.shuffle);

  return (
    <div
      class={`vsi${left < FADE_MS ? ' leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${me.name} versus ${opp.name}`}
    >
      <div class="vsi-shake">
        <Side side="left" name={me.name} you rating={ranked?.players[vm.me]} />
        <Side side="right" name={opp.name} rating={ranked?.players[oppSlot]} />
        <div class="vsi-vs" aria-hidden="true">
          VS
        </div>
        <div class="vsi-flash" aria-hidden="true" />
        <p class="vsi-foot">
          {ranked ? (
            <>
              Ranked {MODES[ranked.mode].label} · <b>{DIVISIONS[ranked.division].label}</b> countries
            </>
          ) : (
            <>Friendly match · {label ?? modes}</>
          )}
        </p>
      </div>
    </div>
  );
}

function Side({
  side,
  name,
  you,
  rating,
}: {
  side: 'left' | 'right';
  name: string;
  you?: boolean;
  rating?: RankedPlayerView;
}) {
  const tint = rating ? rating.division : you ? 'me' : 'opp';
  return (
    <div class={`vsi-side ${side} ${tint}`}>
      {you && <span class="vsi-you">YOU</span>}
      <div class="vsi-emblem">
        {rating ? (
          <Emblem division={rating.division} size={176} label />
        ) : (
          <span class="vsi-initial" aria-hidden="true">
            {[...name][0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>
      <div class="vsi-name">{name}</div>
      {rating && (
        <div class="vsi-meta">
          <span class="vsi-pill">{DIVISIONS[rating.division].label}</span>
          <CountUp to={rating.rating} />
          {rating.provisional && <span class="vsi-prov" title="Provisional rating">?</span>}
        </div>
      )}
    </div>
  );
}

/** Rating that counts up from 0 once the name has appeared. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now() + 850;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / 700));
      el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return (
    <span class="vsi-elo">
      <span ref={ref}>{to}</span>
      <small>ELO</small>
    </span>
  );
}
