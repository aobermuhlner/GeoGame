// Challenges: fixed tasks (e.g. "name every country in Europe", "name every capital of Africa") played
// against the clock. Each one has three medals, which differ only in the time allowed. Nothing is random:
// everyone plays the same thing.
import { CAPITALS } from './capitals';
import { COUNTRIES } from './countries';
import { normalize } from './normalize';
import type { RegionId } from './regions';

export const MEDAL_IDS = ['bronze', 'silver', 'gold'] as const;
export type MedalId = (typeof MEDAL_IDS)[number];

export const MEDAL_LABELS: Record<MedalId, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/** What a challenge asks for: the countries themselves, or their capitals. Either way a run is a list of
 *  country codes. */
export type ChallengeKind = 'countries' | 'capitals';
export const CHALLENGE_KINDS: readonly ChallengeKind[] = ['countries', 'capitals'];

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  label: string;
  /** The regions whose countries must all be named; empty = the whole world */
  regions: readonly RegionId[];
  /** Time allowed per medal (ms), easiest first */
  limits: Record<MedalId, number>;
}

const min = (m: number) => Math.round(m * 60_000);

/** The regions, with their times. Times are first guesses, to be tuned after playtesting. */
const REGIONAL: readonly Omit<Challenge, 'kind'>[] = [
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

/** Country challenges keep the bare region id ("europe"); capital ones are "capitals-europe". Same times. */
export const CHALLENGES: readonly Challenge[] = CHALLENGE_KINDS.flatMap((kind) =>
  REGIONAL.map((c) => ({ ...c, kind, id: kind === 'countries' ? c.id : `${kind}-${c.id}` })),
);

export const WORLD_CHALLENGE = 'world';

/** The whole-world challenge of a kind. */
export const worldChallengeId = (kind: ChallengeKind): string =>
  kind === 'countries' ? WORLD_CHALLENGE : `${kind}-${WORLD_CHALLENGE}`;

export const isWorldChallenge = (ch: Challenge): boolean => ch.id === worldChallengeId(ch.kind);

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
  /** What it counts as: naming the whole world proves every region, so the world medal lifts all others
   *  of the same kind */
  medal: MedalId | null;
  bestMs: number | null;
}

export function challengeStanding(ch: Challenge, bests: ChallengeBests): ChallengeStanding {
  const best = bests[ch.id] ?? null;
  const own = best === null ? null : medalForTime(ch, best);
  const worldId = worldChallengeId(ch.kind);
  const worldBest = ch.id === worldId ? null : (bests[worldId] ?? null);
  const world = worldBest === null ? null : medalForTime(CHALLENGE_BY_ID[worldId], worldBest);
  return { own, medal: betterMedal(own, world), bestMs: best };
}

/** Whether a finished run is a valid completion: every country (or its capital) named, within the limit chosen. */
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

/** The names a challenge kind accepts (normalized), each with the country code it stands for. */
export interface Vocab {
  forms: { code: string; form: string }[];
  lookup: Map<string, string>;
}

function makeVocab(items: readonly { code: string; name: string; aliases: string[] }[]): Vocab {
  const lookup = new Map<string, string>();
  for (const it of items) {
    for (const form of [it.name, ...it.aliases].map(normalize)) {
      const existing = lookup.get(form);
      if (existing && existing !== it.code) throw new Error(`Name clash: "${form}" (${existing}/${it.code})`);
      lookup.set(form, it.code);
    }
  }
  return { lookup, forms: [...lookup].map(([form, code]) => ({ code, form })) };
}

export const VOCABS: Record<ChallengeKind, Vocab> = { countries: makeVocab(COUNTRIES), capitals: makeVocab(CAPITALS) };

const COUNTRY_VOCAB = VOCABS.countries;

export function matchTyped(
  text: string,
  pool: ReadonlySet<string>,
  found: ReadonlySet<string>,
  vocab: Vocab = COUNTRY_VOCAB,
): TypedMatch {
  const typed = normalize(text);
  const code = vocab.lookup.get(typed);
  if (!code) return { kind: 'none' };
  if (!pool.has(code)) return { kind: 'outside', code };
  if (found.has(code)) return { kind: 'repeat', code };
  const longer = vocab.forms.some(
    (f) => f.code !== code && pool.has(f.code) && !found.has(f.code) && f.form.length > typed.length && f.form.startsWith(typed),
  );
  return { kind: longer ? 'wait' : 'add', code };
}

/** True if some name (any, or only `code`'s) is longer than `text` and starts with it. */
function startsLonger(vocab: Vocab, text: string, code?: string): boolean {
  const typed = normalize(text);
  return typed !== '' && vocab.forms.some((f) => (!code || f.code === code) && f.form.length > typed.length && f.form.startsWith(typed));
}

/** True if `text` could still become a name (for the "check the spelling" warning while typing). */
export function isLivePrefix(text: string, vocab: Vocab = COUNTRY_VOCAB): boolean {
  const typed = normalize(text);
  return typed === '' || vocab.forms.some((f) => f.form.startsWith(typed));
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
export function typeText(
  raw: string,
  held: Held | null,
  pool: ReadonlySet<string>,
  found: ReadonlySet<string>,
  vocab: Vocab = COUNTRY_VOCAB,
): TypingResult {
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
    const m = matchTyped(text, pool, named, vocab);
    switch (m.kind) {
      case 'add':
        add(m.code);
        return startsLonger(vocab, text, m.code)
          ? { text, held: { code: m.code, text, added: true }, added, notice: null }
          : { text: '', held: null, added, notice: null };
      case 'wait':
        return { text, held: { code: m.code, text, added: false }, added, notice: null };
      case 'repeat':
        if (startsLonger(vocab, text)) return { text, held: held?.code === m.code ? held : null, added, notice: null };
        return { text: '', held: null, added, notice: held?.code === m.code ? null : m };
      case 'outside':
        if (startsLonger(vocab, text)) return { text, held: null, added, notice: null };
        return { text: '', held: null, added, notice: m };
      case 'none': {
        const extends_ = held !== null && text.length > held.text.length && text.startsWith(held.text);
        if (!held || !extends_ || isLivePrefix(text, vocab)) return { text, held: extends_ ? held : null, added, notice: null };
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
export function submitText(
  raw: string,
  held: Held | null,
  pool: ReadonlySet<string>,
  found: ReadonlySet<string>,
  vocab: Vocab = COUNTRY_VOCAB,
): TypingResult {
  const m = matchTyped(raw, pool, found, vocab);
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
