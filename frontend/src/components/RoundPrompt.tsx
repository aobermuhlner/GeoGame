// Prompts and reveals of the Landmarks and Languages games (lock-in games).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LANDMARK_META, languageFactsLine, languageOfItem, photoZoom, type LockView } from '@flagduel/shared';
import { CREDITS_URL } from './common';
import { LocateMap } from './LocateMap';

/**
 * A landmark photo that starts zoomed in on `focus` and zooms out over the round. The zoom follows the
 * round's clock (`startedAt`, local ms), so a reload or a late image lands at the same zoom as the opponent's.
 * `full`: show the whole photo (reveal).
 */
export function ZoomPhoto({
  src,
  focus,
  startedAt,
  full,
}: {
  src: string;
  focus: [number, number];
  startedAt: number | null;
  full: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const el = img.current;
    if (!el) return;
    if (full || startedAt === null) {
      el.style.transition = 'transform 0.6s ease-out';
      el.style.transform = 'scale(1)';
      return;
    }
    el.style.transition = 'none';
    let frame = 0;
    const step = () => {
      el.style.transform = `scale(${photoZoom(Date.now() - startedAt)})`;
      frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [full, startedAt, src]);

  return (
    <div class="photo-frame">
      {!loaded && <div class="flag-skeleton" aria-hidden="true" />}
      <img
        ref={img}
        class={`photo${loaded ? '' : ' pending'}`}
        src={src}
        alt={full ? 'The landmark' : 'Zoomed-in part of a landmark'}
        draggable={false}
        style={{ transformOrigin: `${focus[0] * 100}% ${focus[1] * 100}%` }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

/** The Languages game's sentence (and on the reveal, its translation). */
export function SentenceCard({ text, translation }: { text: string; translation?: string | null }) {
  return (
    <figure class="sentence-card">
      <blockquote lang="" dir="auto">
        {text}
      </blockquote>
      {translation && <figcaption>{translation}</figcaption>}
    </figure>
  );
}

/** Languages reveal: where the sentence's language is spoken most and in how many countries it is official. */
export function LanguageFacts({ code }: { code: string }) {
  const line = languageFactsLine(languageOfItem(code));
  return line ? <span class="reveal-of language-facts">{line}</span> : null;
}

/** "Photo: Author · CC BY-SA 4.0", linking to the photo's Commons page. */
export function PhotoCredit({ id }: { id: string }) {
  const m = LANDMARK_META[id];
  if (!m) return null;
  return (
    <p class="photo-credit">
      Photo:{' '}
      <a href={m.source} target="_blank" rel="noopener noreferrer">
        {m.author}
      </a>{' '}
      · {m.license} ·{' '}
      <a href={CREDITS_URL} target="_blank" rel="noopener">
        all credits
      </a>
    </p>
  );
}

/** Where the landmark is: its country highlighted, a pin on the spot. */
export function RevealMap({ country, landmark }: { country: string; landmark: string }) {
  // Mount after the reveal's pop-in so the map's own zoom animation is visible.
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOn(true), 50);
    return () => clearTimeout(id);
  }, []);
  return (
    <div class="reveal-map">
      <LocateMap marks={{ [country]: 'target' }} focus={on ? country : null} pin={landmark} disabled />
    </div>
  );
}

/** Both players' locked-in answers: "You: Italy ✗ · Lena: France ✓ +2". */
export function LockLines({
  locks,
  points,
  names,
  me,
  label = (a) => a,
}: {
  locks: [LockView | null, LockView | null];
  points: [number, number];
  names: [string, string];
  me: 0 | 1;
  /** How an answer is shown (pins: "312 km off · 500 km circle") */
  label?: (answer: string) => string;
}) {
  const order = me === 0 ? ([0, 1] as const) : ([1, 0] as const);
  return (
    <ul class="lock-lines">
      {order.map((s) => {
        const l = locks[s];
        return (
          <li key={s} class={l ? (l.correct ? 'ok' : 'bad') : 'none'}>
            <span class="ll-name">{s === me ? 'You' : names[s]}</span>
            <span class="ll-answer">{l ? label(l.answer) : 'no answer'}</span>
            <span class="ll-mark">{l ? (l.correct ? '✓' : '✗') : '—'}</span>
            {points[s] > 0 && <span class="ll-points">+{points[s]}</span>}
          </li>
        );
      })}
    </ul>
  );
}
