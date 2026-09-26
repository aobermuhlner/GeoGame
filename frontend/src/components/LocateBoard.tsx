import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
}: Props) {
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
    <div class="locate-board">
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
      <div class="locate-stage">
        <LocateMap
          onPick={pick}
          marks={shown}
          focus={missed}
          resetKey={roundKey}
          region={regions.length === 1 ? regions[0] : null}
          disabled={blocked}
        />
        {overlay && <div class="locate-overlay">{overlay}</div>}
      </div>
      {status}
      <div class="locate-foot">
        <span class="tries" aria-label={`${left} of ${LOCATE_TRIES} tries left`}>
          {Array.from({ length: LOCATE_TRIES }, (_, i) => (
            <span key={i} class={`try${i < left ? '' : ' used'}`} />
          ))}
          <span class="muted small">{left === 1 ? '1 try left' : `${left} tries left`}</span>
        </span>
        <span class="muted small map-hint">Scroll or pinch to zoom · drag to pan</span>
        <button class="btn btn-primary" type="button" disabled={locked || found || left === 0} onClick={onPass}>
          Pass
        </button>
      </div>
    </div>
  );
}
