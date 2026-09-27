import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { LOCATE_TRIES, type GuessOutcome, type RegionId } from '@flagduel/shared';
import { LocateMap, type Mark } from './LocateMap';

interface Props {
  /** Country to find (null during a countdown) */
  prompt: string | null;
  flagUrl?: string | null;
  /** Changes every round: clears the marks and zooms back out */
  roundKey: string | number;
  /** No clicks accepted (countdown, reveal, passed, out of tries) */
  locked: boolean;
  /** ISO code of the answer once the round is over */
  answerCode: string | null;
  onGuess: (code: string) => Promise<GuessOutcome> | GuessOutcome;
  onPass: () => void;
  /** The match's regions: with exactly one, rounds start zoomed in on it */
  regions?: readonly RegionId[];
  /** Wrong guesses the server already counted this round (a resumed round) */
  serverWrong?: number;
  /** Shown over the map (countdowns) */
  overlay?: ComponentChildren;
  /** Status line between the map and the controls */
  status?: ComponentChildren;
  /** Round / score / timer, shown over the map in full-screen mode (the page's top card is hidden then) */
  hud?: ComponentChildren;
}

const FS_KEY = 'fd.mapFullscreen';
const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function savedFs(): boolean {
  try {
    return localStorage.getItem(FS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Phones only: the map can fill the whole screen in landscape. Where the browser can lock the orientation
 * (Android, in real full screen) it does; otherwise a phone held upright gets the board rotated by CSS.
 * The choice is remembered, so the next map game opens full screen again.
 */
function useMapFullscreen() {
  const [touch] = useState(isTouch);
  const [fs, setFs] = useState(() => touch && savedFs());
  const [portrait, setPortrait] = useState(() => typeof matchMedia === 'function' && matchMedia('(orientation: portrait)').matches);
  const realFs = useRef(false);

  useEffect(() => {
    const mq = matchMedia('(orientation: portrait)');
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    // Leaving the browser's full screen (e.g. Android back) leaves ours too.
    const on = () => {
      if (!document.fullscreenElement && realFs.current) {
        realFs.current = false;
        toggle(false);
      }
    };
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      if (realFs.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('map-fs-open', fs);
    return () => document.documentElement.classList.remove('map-fs-open');
  }, [fs]);

  function toggle(on: boolean) {
    setFs(on);
    try {
      localStorage.setItem(FS_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (on) {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' })
          .then(() => {
            realFs.current = true;
            // Not supported everywhere (iOS): the CSS rotation covers that.
            return (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
          })
          .catch(() => {});
      }
    } else if (realFs.current) {
      realFs.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }

  return { touch, fs, rotated: fs && portrait, toggle };
}

/** GeoLocate round: "Find <country>", the world map, tries left and a Pass button. */
export function LocateBoard({
  prompt,
  flagUrl,
  roundKey,
  locked,
  answerCode,
  onGuess,
  onPass,
  regions = [],
  serverWrong = 0,
  overlay,
  status,
  hud,
}: Props) {
  const { touch, fs, rotated, toggle } = useMapFullscreen();
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMarks({});
    setPending(false);
  }, [roundKey]);

  const wrong = Math.max(serverWrong, Object.values(marks).filter((m) => m === 'wrong').length);
  const found = Object.values(marks).includes('correct');
  const left = Math.max(0, LOCATE_TRIES - wrong);
  const blocked = locked || pending || found || left === 0;

  async function pick(code: string) {
    if (blocked || marks[code]) return;
    setPending(true);
    try {
      const outcome = await onGuess(code);
      if (outcome !== 'ignored') setMarks((m) => ({ ...m, [code]: outcome === 'correct' ? 'correct' : 'wrong' }));
    } finally {
      setPending(false);
    }
  }

  // The reveal can arrive before our own click's result: wait for it before showing a miss.
  const missed = answerCode && !found && !pending ? answerCode : null;
  const shown = missed ? { ...marks, [missed]: 'target' as Mark } : marks;

  return (
    <div class={`locate-board${fs ? ' fs' : ''}${rotated ? ' rotated' : ''}`}>
      <div class="locate-top">
        {fs && hud && <div class="locate-hud">{hud}</div>}
        <div class="locate-prompt" aria-live="polite">
          {prompt ? (
            <>
              {flagUrl && <img class="locate-flag" src={flagUrl} alt="" draggable={false} />}
              <span class="muted">Find</span> <strong>{prompt}</strong>
            </>
          ) : (
            <span class="muted">Get ready…</span>
          )}
        </div>
      </div>
      <div class="locate-stage">
        <LocateMap
          onPick={pick}
          marks={shown}
          focus={missed}
          resetKey={roundKey}
          region={regions.length === 1 ? regions[0] : null}
          disabled={blocked}
          rotated={rotated}
          extraControl={
            touch ? (
              <button
                type="button"
                class="lm-fs"
                aria-label={fs ? 'Exit full screen' : 'Full screen map'}
                title={fs ? 'Exit full screen' : 'Full screen map'}
                onClick={() => toggle(!fs)}
              >
                {fs ? (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                )}
              </button>
            ) : null
          }
        />
        {overlay && <div class="locate-overlay">{overlay}</div>}
      </div>
      <div class="locate-bottom">
        {status}
        <div class="locate-foot">
          <span class="tries" aria-label={`${left} of ${LOCATE_TRIES} tries left`}>
            {Array.from({ length: LOCATE_TRIES }, (_, i) => (
              <span key={i} class={`try${i < left ? '' : ' used'}`} />
            ))}
            <span class="muted small">{left === 1 ? '1 try left' : `${left} tries left`}</span>
          </span>
          <span class="muted small map-hint">Scroll or pinch to zoom · drag to pan</span>
          <button class="btn btn-pass" type="button" disabled={locked || found || left === 0} onClick={onPass}>
            Pass
          </button>
        </div>
      </div>
    </div>
  );
}
