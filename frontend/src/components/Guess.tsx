// GeoGuesser: the question card, the number input with its unit switch, and how estimates are shown.
// Answers travel in canonical units (°C, km, m, km²); everything here converts to the player's own units.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  GUESS_BY_ID,
  IMPERIAL,
  METRIC,
  SPOT_ON,
  UNIT_CHOICES,
  accuracyOf,
  canonicalText,
  formatQuantity,
  fromUserUnit,
  parseCanonical,
  parseEstimate,
  parseGuessPrompt,
  prefKeyOf,
  toUserUnit,
  unitLabel,
  type GuessOutcome,
  type GuessQuestion,
  type LockView,
  type Quantity,
  type UnitPrefs,
} from '@flagduel/shared';
import { codeFlagSrc } from '../api';

// ---------- Unit preferences (per browser) ----------

const PREFS_KEY = 'flagduel.units';

/** First visit: US-style units for US English browsers (and Liberia, Myanmar), metric elsewhere. */
function defaultPrefs(): UnitPrefs {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return /^en-(US|LR)$|^my\b/i.test(lang) ? { ...IMPERIAL } : { ...METRIC };
}

function loadPrefs(): UnitPrefs {
  const base = defaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(UNIT_CHOICES) as (keyof UnitPrefs)[]) {
        if ((UNIT_CHOICES[k] as readonly string[]).includes(saved[k])) (base as Record<string, string>)[k] = saved[k];
      }
    }
  } catch {
    /* storage unavailable: defaults */
  }
  return base;
}

let prefs = loadPrefs();
const listeners = new Set<(p: UnitPrefs) => void>();

export function setUnitPrefs(next: UnitPrefs) {
  prefs = next;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* kept for this page only */
  }
  for (const l of listeners) l(next);
}

/** The player's units; re-renders when they change anywhere. */
export function useUnits(): UnitPrefs {
  const [p, setP] = useState(prefs);
  useEffect(() => {
    listeners.add(setP);
    setP(prefs);
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

/** Switch one quantity to its other unit (°C ⇄ °F, km ⇄ mi, …). */
function toggleUnit(q: Quantity) {
  const k = prefKeyOf(q);
  if (!k) return;
  const choices = UNIT_CHOICES[k] as readonly string[];
  const next = choices[(choices.indexOf(prefs[k]) + 1) % choices.length];
  setUnitPrefs({ ...prefs, [k]: next } as UnitPrefs);
}

// ---------- Display helpers ----------

const ICONS: Record<Quantity, string> = {
  temperature: '🌡️',
  length: '📏',
  elevation: '⛰️',
  area: '🗺️',
  density: '🏘️',
  people: '👥',
  count: '🔢',
  percent: '📊',
  year: '📅',
  years: '⏳',
  children: '👶',
  usd: '💵',
  degrees: '🧭',
};

/** A canonical answer as text in the player's units ("29,032 ft"); the raw text if it isn't a number. */
export function formatEstimate(quantity: Quantity, raw: string, p: UnitPrefs): string {
  const v = parseCanonical(raw);
  return v === null ? raw : formatQuantity(quantity, v, p);
}

/** "12 % too high", "3.4 °F too low", "spot on" */
export function offByText(q: Pick<GuessQuestion, 'quantity' | 'answer'>, estimate: number, p: UnitPrefs): string {
  const acc = accuracyOf(q, estimate);
  if (estimate === q.answer) return 'exact!';
  const dir = estimate > q.answer ? 'too high' : 'too low';
  const logScale = ['people', 'area', 'density', 'usd', 'count', 'length', 'elevation'].includes(q.quantity);
  if (logScale && q.answer > 0) {
    if (estimate <= 0) return dir;
    const ratio = estimate / q.answer;
    const factor = ratio >= 1 ? ratio : 1 / ratio;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    const txt =
      factor >= 2 ? `${factor.toFixed(factor >= 10 ? 0 : 1)}× ${dir}` : pct === 0 ? 'within 1 %' : `${pct} % ${dir}`;
    return acc >= SPOT_ON ? `spot on (${txt})` : txt;
  }
  // Differences: converted to the player's unit (a temperature difference has no offset).
  const diff = Math.abs(toUserUnit(q.quantity, estimate, p) - toUserUnit(q.quantity, q.answer, p));
  const unit = q.quantity === 'year' ? (diff === 1 ? 'year' : 'years') : q.quantity === 'percent' ? 'points' : unitLabel(q.quantity, p);
  const n = diff >= 10 ? Math.round(diff) : Math.round(diff * 10) / 10;
  const txt = n === 0 ? 'almost exact' : `${n}${unit === '°C' || unit === '°F' ? '' : ' '}${unit} ${dir}`;
  return acc >= SPOT_ON ? `spot on (${txt})` : txt;
}

/** The question behind a prompt or a revealed item. */
export function questionOf(prompt: string | null, code: string | null): { quantity: Quantity; text: string } | null {
  const q = code ? GUESS_BY_ID[code] : undefined;
  if (q) return { quantity: q.quantity, text: q.text };
  return prompt ? parseGuessPrompt(prompt) : null;
}

// ---------- Question card ----------

/** The question; on the reveal also the answer, a note, and where the number comes from. */
export function QuestionCard({ prompt, code }: { prompt: string | null; code?: string | null }) {
  const p = useUnits();
  const revealed = code ? GUESS_BY_ID[code] : undefined;
  const q = questionOf(prompt, code ?? null);
  if (!q) return null;
  return (
    <figure class={`question-card${revealed ? ' revealed' : ''}`}>
      <div class="qc-head">
        <span class="qc-icon" aria-hidden="true">
          {ICONS[q.quantity]}
        </span>
        {revealed?.country && <img class="qc-flag" src={codeFlagSrc(revealed.country)} alt="" />}
      </div>
      <blockquote>{q.text}</blockquote>
      {revealed && (
        <figcaption>
          <strong class="qc-answer">{formatQuantity(revealed.quantity, revealed.answer, p)}</strong>
          <AltUnit quantity={revealed.quantity} value={revealed.answer} />
          {revealed.note && <span class="qc-note">{revealed.note}</span>}
          <span class="qc-source">Source: {revealed.source}</span>
        </figcaption>
      )}
    </figure>
  );
}

/** The same value in the other unit, small ("= 29,032 ft"), for quantities that have one. */
function AltUnit({ quantity, value }: { quantity: Quantity; value: number }) {
  const p = useUnits();
  const k = prefKeyOf(quantity);
  if (!k) return null;
  const other = { ...p, [k]: p[k] === UNIT_CHOICES[k][0] ? UNIT_CHOICES[k][1] : UNIT_CHOICES[k][0] } as UnitPrefs;
  return <span class="qc-alt">= {formatQuantity(quantity, value, other)}</span>;
}

// ---------- Input ----------

/** Quantities that often run into millions (the hint mentions "1.5m"). */
const BIG = new Set<Quantity>(['people', 'count', 'usd']);

/**
 * Number field with the unit next to it (tap to switch °C ⇄ °F, km ⇄ mi, m ⇄ ft, km² ⇄ mi²) and a line that
 * shows how the typed text is read. Submits the canonical number.
 */
export function NumberInput({
  quantity,
  locked,
  focusKey,
  onSubmit,
}: {
  quantity: Quantity | null;
  locked: boolean;
  focusKey: unknown;
  onSubmit: (text: string) => Promise<GuessOutcome> | GuessOutcome;
}) {
  const p = useUnits();
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = quantity ?? 'count';
  const parsed = useMemo(() => parseEstimate(value, q), [value, q]);
  const convertible = prefKeyOf(q) !== null;
  const unit = unitLabel(q, p);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [focusKey, locked]);
  useEffect(() => {
    if (locked) setValue('');
  }, [locked]);

  async function submit() {
    if (locked || parsed === null) {
      if (value.trim()) {
        setWrong(false);
        requestAnimationFrame(() => setWrong(true));
      }
      return;
    }
    const text = canonicalText(fromUserUnit(q, parsed, p));
    const typed = value;
    setValue('');
    const outcome = await onSubmit(text);
    if (outcome === 'invalid') {
      setValue(typed);
      setWrong(false);
      requestAnimationFrame(() => setWrong(true));
    }
  }

  return (
    <div class="number-input">
      <div class="ni-row">
        <div class="ni-field">
          <input
            ref={inputRef}
            class={`guess-input${wrong ? ' is-wrong' : ''}`}
            type="text"
            inputMode="decimal"
            placeholder={locked ? '' : 'Your estimate…'}
            value={value}
            maxLength={32}
            aria-disabled={locked}
            aria-label={`Your estimate${unit ? ` in ${unit}` : ''}`}
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            enterKeyHint="send"
            onInput={(e) => {
              const el = e.target as HTMLInputElement;
              if (locked) {
                el.value = '';
                return;
              }
              setValue(el.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            onAnimationEnd={() => setWrong(false)}
          />
          {unit &&
            (convertible ? (
              <button
                type="button"
                class="ni-unit switch"
                title="Switch unit"
                // Keep focus (and the phone keyboard) on the field.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleUnit(q)}
              >
                {unit} <span aria-hidden="true">⇄</span>
              </button>
            ) : (
              <span class="ni-unit">{unit}</span>
            ))}
        </div>
        <button
          class="btn btn-primary"
          type="button"
          disabled={locked}
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          Lock in
        </button>
      </div>
      <p class="ni-preview muted small" aria-live="polite">
        {locked
          ? ' '
          : value.trim() === ''
            ? convertible
              ? `Answer in ${unit} — tap the unit to switch`
              : BIG.has(q)
                ? 'Type a number — "1.5 million" or "1.5m" works too'
                : q === 'year'
                  ? 'Type a year — "300 BC" works too'
                  : 'Type a number'
            : parsed === null
              ? 'That doesn’t look like a number'
              : `= ${formatQuantity(q, fromUserUnit(q, parsed, p), p)}`}
      </p>
    </div>
  );
}

// ---------- Estimates on the reveal ----------

/** One estimate: value, how far off, points. */
export function EstimateLine({
  who,
  code,
  raw,
  points,
  pointsLabel,
}: {
  who: string;
  code: string;
  raw: string | null;
  points: number;
  pointsLabel?: string;
}) {
  const p = useUnits();
  const q = GUESS_BY_ID[code];
  const v = raw !== null ? parseCanonical(raw) : null;
  const acc = q && v !== null ? accuracyOf(q, v) : 0;
  return (
    <li class={v === null ? 'none' : acc >= SPOT_ON ? 'ok spot' : points > 0 ? 'ok' : 'bad'}>
      <span class="ll-name">{who}</span>
      <span class="ll-answer">{q && v !== null ? formatQuantity(q.quantity, v, p) : 'no answer'}</span>
      {q && v !== null && <span class="ll-off">{offByText(q, v, p)}</span>}
      {acc >= SPOT_ON && <span aria-label="spot on">🎯</span>}
      {points > 0 && <span class="ll-points">+{pointsLabel ?? points}</span>}
    </li>
  );
}

/** Both duel players' estimates. */
export function EstimateLines({
  code,
  locks,
  points,
  names,
  me,
}: {
  code: string;
  locks: [LockView | null, LockView | null];
  points: [number, number];
  names: [string, string];
  me: 0 | 1;
}) {
  const order = me === 0 ? ([0, 1] as const) : ([1, 0] as const);
  return (
    <ul class="lock-lines estimates">
      {order.map((s) => (
        <EstimateLine key={s} who={s === me ? 'You' : names[s]} code={code} raw={locks[s]?.answer ?? null} points={points[s]} />
      ))}
    </ul>
  );
}


/** Quick switch between metric and US units for every quantity at once. */
export function UnitSystemSwitch() {
  const p = useUnits();
  const metric = Object.entries(METRIC).every(([k, v]) => p[k as keyof UnitPrefs] === v);
  const imperial = Object.entries(IMPERIAL).every(([k, v]) => p[k as keyof UnitPrefs] === v);
  return (
    <div class="seg unit-switch" role="group" aria-label="Units">
      <button class={metric ? 'on' : ''} aria-pressed={metric} onClick={() => setUnitPrefs({ ...METRIC })}>
        Metric (°C, km, m)
      </button>
      <button class={imperial ? 'on' : ''} aria-pressed={imperial} onClick={() => setUnitPrefs({ ...IMPERIAL })}>
        US (°F, mi, ft)
      </button>
    </div>
  );
}

/** A results-table cell: the question and its answer in the player's units. */
export function GuessAnswerCell({ code }: { code: string }) {
  const p = useUnits();
  const q = GUESS_BY_ID[code];
  if (!q) return null;
  return (
    <>
      {formatQuantity(q.quantity, q.answer, p)}
      <span class="of-country">{q.text}</span>
    </>
  );
}
