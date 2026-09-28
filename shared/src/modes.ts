// Minigame registry. A match plays each selected mode in turn (ROUNDS_PER_GAME rounds each).
// To add a minigame: add its id to MODE_IDS and an entry to MODES.
//
// A round is about one *item*: an ISO country code (flags, capitals, locate), a landmark id or a
// sentence ("spa.3" = Spanish sentence 3). The mode says what the item shows and what answers it.
import { CAPITAL_BY_CODE } from './capitals';
import { COUNTRY_BY_CODE } from './countries';
import { LANDMARK_BY_ID, landmarksInRegions } from './landmarkRules';
import { LANGUAGE_BY_ID, SENTENCE_ITEMS, languageNameOf, languageOfItem, sentenceOf } from './languageRules';
import { isCorrectGuess, normalize, resolveGuess } from './normalize';
import { REGION_OF, type RegionId } from './regions';
import { suggestCapitals, suggestCountries, suggestLanguages } from './suggest';

export const MODE_IDS = ['flags', 'capitals', 'locate', 'landmarks', 'languages'] as const;

export type ModeId = (typeof MODE_IDS)[number];

/** Games with a ranked ladder: their rounds are countries, so they can use the divisions' country pools. */
export const RANKED_MODE_IDS = ['flags', 'capitals', 'locate'] as const satisfies readonly ModeId[];

export type RankedModeId = (typeof RANKED_MODE_IDS)[number];

export const isRankedMode = (m: string): m is RankedModeId => (RANKED_MODE_IDS as readonly string[]).includes(m);

export interface Mode {
  label: string;
  /** Lobby blurb */
  description: string;
  /** Headline on the game screen, e.g. "Guess 10 Flags" */
  title: (rounds: number) => string;
  placeholder: string;
  /** How answers are given: typed text, or a click on the world map (the guess is the clicked ISO code) */
  input: 'text' | 'map';
  /** What a round shows: a flag, a (zooming) landmark photo, or a sentence */
  prompt: 'flag' | 'photo' | 'sentence';
  /** What the pool is counted in ("12 countries", "30 landmarks") */
  unit: [one: string, many: string];
  /** The items rounds can be about, given the selected regions */
  pool: (regions: readonly RegionId[]) => string[];
  /** Items of one group are not played twice in a game while the pool allows it (one sentence per language) */
  groupOf?: (item: string) => string;
  /**
   * One final answer per player, locked in and only revealed when the round ends (instead of guessing until
   * right, first correct wins). Text that names no possible answer is refused, so a typo never locks you in.
   */
  lockIn?: boolean;
  /** Wrong guesses allowed per round; reaching it counts as passing (unlimited when absent) */
  maxWrong?: number;
  /** Text shown with the prompt while the round runs (capitals: the country; languages: the sentence) */
  promptText?: (item: string) => string;
  /** ISO code of the country the item belongs to (flag and map on the reveal); null if it isn't about a place */
  countryOf: (item: string) => string | null;
  /** The answer as displayed after the round */
  answerOf: (item: string) => string;
  /** One more line on the reveal (the landmark's name, the sentence's translation) */
  detailOf?: (item: string) => string | null;
  /** Display name of the answer `guess` names, or null if it names none (lock-in modes refuse those) */
  nameOf: (guess: string) => string | null;
  isCorrect: (guess: string, item: string) => boolean;
  suggest: (query: string, limit?: number) => string[];
}

/** Map clicks allowed per GeoLocate round (stops clicking through a whole region). */
export const LOCATE_TRIES = 3;

function isCorrectCapital(guess: string, code: string): boolean {
  const c = CAPITAL_BY_CODE[code];
  const g = normalize(guess);
  return !!c && g !== '' && [c.name, ...c.aliases].some((a) => normalize(a) === g);
}

const countriesIn = (regions: readonly RegionId[]) => {
  const set = new Set(regions);
  return Object.keys(COUNTRY_BY_CODE).filter((c) => set.has(REGION_OF[c]));
};

const countryName = (guess: string) => {
  const code = resolveGuess(guess);
  return code ? COUNTRY_BY_CODE[code].name : null;
};

const countryItems = {
  unit: ['country', 'countries'],
  pool: countriesIn,
  countryOf: (code: string) => code,
} satisfies Partial<Mode>;

export const MODES: Record<ModeId, Mode> = {
  flags: {
    ...countryItems,
    label: 'Flags',
    description: 'See a flag, name the country.',
    title: (n) => `Guess ${n} Flags`,
    placeholder: 'Type a country name…',
    input: 'text',
    prompt: 'flag',
    answerOf: (code) => COUNTRY_BY_CODE[code].name,
    nameOf: countryName,
    isCorrect: isCorrectGuess,
    suggest: suggestCountries,
  },
  capitals: {
    ...countryItems,
    label: 'Capitals',
    description: 'See a flag and country, name its capital.',
    title: (n) => `Name ${n} Capitals`,
    placeholder: 'Type a capital city…',
    input: 'text',
    prompt: 'flag',
    promptText: (code) => COUNTRY_BY_CODE[code].name,
    answerOf: (code) => CAPITAL_BY_CODE[code].name,
    nameOf: (guess) => {
      const g = normalize(guess);
      return Object.values(CAPITAL_BY_CODE).find((c) => [c.name, ...c.aliases].some((a) => normalize(a) === g))?.name ?? null;
    },
    isCorrect: isCorrectCapital,
    suggest: suggestCapitals,
  },
  locate: {
    ...countryItems,
    label: 'GeoLocate',
    description: 'See a country name, find it on the world map.',
    title: (n) => `Find ${n} Countries`,
    placeholder: '',
    input: 'map',
    prompt: 'flag',
    maxWrong: LOCATE_TRIES,
    promptText: (code) => COUNTRY_BY_CODE[code].name,
    answerOf: (code) => COUNTRY_BY_CODE[code].name,
    nameOf: (code) => COUNTRY_BY_CODE[code]?.name ?? null,
    isCorrect: (guess, code) => guess === code,
    suggest: () => [],
  },
  landmarks: {
    label: 'Landmarks',
    description: 'A famous place, zoomed in. Name its country — one answer, locked in.',
    title: (n) => `Spot ${n} Landmarks`,
    placeholder: 'Type a country name…',
    input: 'text',
    prompt: 'photo',
    unit: ['landmark', 'landmarks'],
    pool: landmarksInRegions,
    lockIn: true,
    countryOf: (id) => LANDMARK_BY_ID[id].country,
    answerOf: (id) => COUNTRY_BY_CODE[LANDMARK_BY_ID[id].country].name,
    detailOf: (id) => LANDMARK_BY_ID[id].name,
    nameOf: countryName,
    isCorrect: (guess, id) => resolveGuess(guess) === LANDMARK_BY_ID[id]?.country,
    suggest: suggestCountries,
  },
  languages: {
    label: 'Languages',
    description: 'Read a sentence, name its language — one answer, locked in.',
    title: (n) => `Name ${n} Languages`,
    placeholder: 'Type a language…',
    input: 'text',
    prompt: 'sentence',
    unit: ['sentence', 'sentences'],
    // Languages aren't tied to the map regions.
    pool: () => SENTENCE_ITEMS,
    groupOf: languageOfItem,
    lockIn: true,
    promptText: (item) => sentenceOf(item).text,
    countryOf: () => null,
    answerOf: (item) => LANGUAGE_BY_ID[languageOfItem(item)].name,
    detailOf: (item) => `“${sentenceOf(item).en}”`,
    nameOf: languageNameOf,
    isCorrect: (guess, item) => {
      const lang = LANGUAGE_BY_ID[languageOfItem(item)];
      const g = normalize(guess);
      return !!lang && g !== '' && [lang.name, ...lang.aliases].some((a) => normalize(a) === g);
    },
    suggest: suggestLanguages,
  },
};

/** "12 countries" / "1 landmark" */
export function poolLabel(mode: ModeId, n: number): string {
  const [one, many] = MODES[mode].unit;
  return `${n} ${n === 1 ? one : many}`;
}

/** Everything the reveal shows about a round's item. */
export function itemInfo(mode: ModeId, item: string) {
  const m = MODES[mode];
  const country = m.countryOf(item);
  return {
    country,
    countryName: country ? COUNTRY_BY_CODE[country].name : '',
    answer: m.answerOf(item),
    detail: m.detailOf?.(item) ?? null,
  };
}
