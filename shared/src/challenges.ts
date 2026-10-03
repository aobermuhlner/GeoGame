// Challenges: fixed tasks (e.g. "name every country in Europe") played against the clock. Each one has
// three medals, which differ only in the time allowed. Nothing is random: everyone plays the same thing.
import { COUNTRIES } from './countries';
import { acceptedForms, normalize, resolveGuess } from './normalize';
import type { RegionId } from './regions';

export const MEDAL_IDS = ['bronze', 'silver', 'gold'] as const;
export type MedalId = (typeof MEDAL_IDS)[number];

export const MEDAL_LABELS: Record<MedalId, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export interface Challenge {
  id: string;
  label: string;
  /** The regions whose countries must all be named; empty = the whole world */
  regions: readonly RegionId[];
  /** Time allowed per medal (ms), easiest first */
  limits: Record<MedalId, number>;
}

const min = (m: number) => Math.round(m * 60_000);

/** The country challenges. Times are first guesses, to be tuned after playtesting. */
export const CHALLENGES: readonly Challenge[] = [
  { id: 'europe', label: 'Europe', regions: ['europe'], limits: { bronze: min(10), silver: min(5), gold: min(2) } },
  { id: 'asia', label: 'Asia', regions: ['asia'], limits: { bronze: min(10), silver: min(5), gold: min(2.5) } },
  { id: 'africa', label: 'Africa', regions: ['africa'], limits: { bronze: min(12), silver: min(6), gold: min(3) } },
  { id: 'oceania', label: 'Oceania', regions: ['oceania'], limits: { bronze: min(4), silver: min(2), gold: min(1) } },
  {
    id: 'americas',
    label: 'North & Central America, Caribbean',
    regions: ['north-america', 'central-america', 'caribbean'],
    limits: { bronze: min(6), silver: min(3), gold: min(1.5) },
  },
  {
    id: 'south-america',
    label: 'South America',
    regions: ['south-america'],
    limits: { bronze: min(3), silver: min(1.5), gold: min(0.75) },
  },
  { id: 'world', label: 'The whole world', regions: [], limits: { bronze: min(25), silver: min(15), gold: min(10) } },
];

export const WORLD_CHALLENGE = 'world';

export const CHALLENGE_BY_ID: Record<string, Challenge> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

/** The countries a challenge asks for (ISO codes). */
export function challengeCodes(ch: Challenge): string[] {
  const set = new Set(ch.regions);
  return COUNTRIES.filter((c) => set.size === 0 || set.has(c.region)).map((c) => c.code);
}

/** The best medal a full completion in `timeMs` earns, or null if it was too slow for bronze. */
export function medalForTime(ch: Challenge, timeMs: number): MedalId | null {
  for (let i = MEDAL_IDS.length - 1; i >= 0; i--) if (timeMs <= ch.limits[MEDAL_IDS[i]]) return MEDAL_IDS[i];
  return null;
}

export const medalRank = (m: MedalId | null): number => (m ? MEDAL_IDS.indexOf(m) + 1 : 0);
export const betterMedal = (a: MedalId | null, b: MedalId | null): MedalId | null => (medalRank(a) >= medalRank(b) ? a : b);

/** A player's challenge record: best full-completion time per challenge id. */
export type ChallengeBests = Record<string, number>;

export interface ChallengeStanding {
  /** The medal won in this challenge itself */
  own: MedalId | null;
  /** What it counts as: naming the whole world proves every region, so the world medal lifts all others */
  medal: MedalId | null;
  bestMs: number | null;
}

export function challengeStanding(ch: Challenge, bests: ChallengeBests): ChallengeStanding {
  const best = bests[ch.id] ?? null;
  const own = best === null ? null : medalForTime(ch, best);
  const worldBest = ch.id === WORLD_CHALLENGE ? null : (bests[WORLD_CHALLENGE] ?? null);
  const world = worldBest === null ? null : medalForTime(CHALLENGE_BY_ID[WORLD_CHALLENGE], worldBest);
  return { own, medal: betterMedal(own, world), bestMs: best };
}

/** Whether a finished run is a valid completion: every country named, within the limit chosen. */
export function isCompletion(ch: Challenge, codes: readonly string[], timeMs: number): boolean {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > ch.limits.bronze) return false;
  const named = new Set(codes);
  return challengeCodes(ch).every((c) => named.has(c));
}

// ---------- Typing ----------

/**
 * What the text typed so far means, checked on every keystroke:
 * - `add`: a country of the challenge not yet named — enter it right away
 * - `wait`: names a country, but is also the start of another unnamed one ("Niger" → "Nigeria", "UK" →
 *   "Ukraine"), so it is only entered on Enter (or when the longer name is typed out)
 * - `repeat`: a country already named
 * - `outside`: a real country that isn't part of this challenge
 * - `none`: not (yet) a country
 */
export type TypedMatch =
  | { kind: 'add'; code: string }
  | { kind: 'wait'; code: string }
  | { kind: 'repeat'; code: string }
  | { kind: 'outside'; code: string }
  | { kind: 'none' };

/** Accepted forms of every country, for the prefix check. */
const FORMS: { code: string; form: string }[] = COUNTRIES.flatMap((c) =>
  [...new Set(acceptedForms(c))].map((form) => ({ code: c.code, form })),
);

export function matchTyped(text: string, pool: ReadonlySet<string>, found: ReadonlySet<string>): TypedMatch {
  const code = resolveGuess(text);
  if (!code) return { kind: 'none' };
  if (!pool.has(code)) return { kind: 'outside', code };
  if (found.has(code)) return { kind: 'repeat', code };
  const typed = normalize(text);
  const longer = FORMS.some(
    (f) => f.code !== code && pool.has(f.code) && !found.has(f.code) && f.form.length > typed.length && f.form.startsWith(typed),
  );
  return { kind: longer ? 'wait' : 'add', code };
}

/** True if some country name (any country, or only `code`'s) is longer than `text` and starts with it. */
function startsLonger(text: string, code?: string): boolean {
  const typed = normalize(text);
  return typed !== '' && FORMS.some((f) => (!code || f.code === code) && f.form.length > typed.length && f.form.startsWith(typed));
}

/** True if `text` could still become a country name (for the "check the spelling" warning while typing). */
export function isLivePrefix(text: string): boolean {
  const typed = normalize(text);
  return typed === '' || FORMS.some((f) => f.form.startsWith(typed));
}

/**
 * Text kept in the input after it named a country, because it may still grow into a longer name: of the
 * same country ("Bosnia" → "Bosnia and Herzegovina", `added`: it already counts) or of another one
 * ("Niger" → "Nigeria", not added yet). Typing on past a dead end splits the new letters off.
 */
export interface Held {
  code: string;
  text: string;
  added: boolean;
}

export type TypingNotice = { kind: 'repeat' | 'outside'; code: string } | { kind: 'unknown'; text: string };

export interface TypingResult {
  /** What the input should show now */
  text: string;
  held: Held | null;
  /** Countries named by this keystroke (usually none or one) */
  added: string[];
  notice: TypingNotice | null;
}

/** The input changed to `raw`: enter whatever it names. */
export function typeText(raw: string, held: Held | null, pool: ReadonlySet<string>, found: ReadonlySet<string>): TypingResult {
  const added: string[] = [];
  const named = new Set(found);
  const add = (code: string) => {
    if (!named.has(code)) {
      named.add(code);
      added.push(code);
    }
  };
  let text = raw;
  // Each pass either returns or shortens the text (splitting off what follows a held name).
  for (;;) {
    const m = matchTyped(text, pool, named);
    switch (m.kind) {
      case 'add':
        add(m.code);
        return startsLonger(text, m.code)
          ? { text, held: { code: m.code, text, added: true }, added, notice: null }
          : { text: '', held: null, added, notice: null };
      case 'wait':
        return { text, held: { code: m.code, text, added: false }, added, notice: null };
      case 'repeat':
        if (startsLonger(text)) return { text, held: held?.code === m.code ? held : null, added, notice: null };
        return { text: '', held: null, added, notice: held?.code === m.code ? null : m };
      case 'outside':
        if (startsLonger(text)) return { text, held: null, added, notice: null };
        return { text: '', held: null, added, notice: m };
      case 'none': {
        const extends_ = held !== null && text.length > held.text.length && text.startsWith(held.text);
        if (!held || !extends_ || isLivePrefix(text)) return { text, held: extends_ ? held : null, added, notice: null };
        // Typed on past a name that can't grow any further: that name was meant, the rest is a new one.
        if (!held.added) add(held.code);
        text = text.slice(held.text.length).trimStart();
        held = null;
        if (text === '') return { text, held, added, notice: null };
      }
    }
  }
}

/** Enter pressed. */
export function submitText(raw: string, held: Held | null, pool: ReadonlySet<string>, found: ReadonlySet<string>): TypingResult {
  const m = matchTyped(raw, pool, found);
  switch (m.kind) {
    case 'add':
    case 'wait':
      return { text: '', held: null, added: [m.code], notice: null };
    case 'repeat':
      return { text: '', held: null, added: [], notice: held?.code === m.code && held.added ? null : m };
    case 'outside':
      return { text: '', held: null, added: [], notice: m };
    case 'none':
      return { text: raw, held, added: [], notice: raw.trim() ? { kind: 'unknown', text: raw.trim() } : null };
  }
}
