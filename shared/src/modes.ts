// Minigame registry. A match plays each selected mode in turn (ROUNDS_PER_GAME rounds each).
// To add a minigame: add its id to MODE_IDS and an entry to MODES.
import { CAPITAL_BY_CODE } from './capitals';
import { COUNTRY_BY_CODE } from './countries';
import { isCorrectGuess, normalize } from './normalize';
import { suggestCapitals, suggestCountries } from './suggest';

export const MODE_IDS = ['flags', 'capitals', 'locate'] as const;

export type ModeId = (typeof MODE_IDS)[number];

export interface Mode {
  label: string;
  /** Lobby blurb */
  description: string;
  /** Headline on the game screen, e.g. "Guess 10 Flags" */
  title: (rounds: number) => string;
  placeholder: string;
  /** How answers are given: typed text, or a click on the world map (the guess is the clicked ISO code) */
  input: 'text' | 'map';
  /** Wrong guesses allowed per round; reaching it counts as passing (unlimited when absent) */
  maxWrong?: number;
  /** Show the country name next to the flag while the round is running */
  showsCountry: boolean;
  /** The answer as displayed after the round */
  answerOf: (code: string) => string;
  isCorrect: (guess: string, code: string) => boolean;
  suggest: (query: string, limit?: number) => string[];
}

/** Map clicks allowed per GeoLocate round (stops clicking through a whole region). */
export const LOCATE_TRIES = 3;

function isCorrectCapital(guess: string, code: string): boolean {
  const c = CAPITAL_BY_CODE[code];
  const g = normalize(guess);
  return !!c && g !== '' && [c.name, ...c.aliases].some((a) => normalize(a) === g);
}

export const MODES: Record<ModeId, Mode> = {
  flags: {
    label: 'Flags',
    description: 'See a flag, name the country.',
    title: (n) => `Guess ${n} Flags`,
    placeholder: 'Type a country name…',
    input: 'text',
    showsCountry: false,
    answerOf: (code) => COUNTRY_BY_CODE[code].name,
    isCorrect: isCorrectGuess,
    suggest: suggestCountries,
  },
  capitals: {
    label: 'Capitals',
    description: 'See a flag and country, name its capital.',
    title: (n) => `Name ${n} Capitals`,
    placeholder: 'Type a capital city…',
    input: 'text',
    showsCountry: true,
    answerOf: (code) => CAPITAL_BY_CODE[code].name,
    isCorrect: isCorrectCapital,
    suggest: suggestCapitals,
  },
  locate: {
    label: 'GeoLocate',
    description: 'See a country name, find it on the world map.',
    title: (n) => `Find ${n} Countries`,
    placeholder: '',
    input: 'map',
    maxWrong: LOCATE_TRIES,
    showsCountry: true,
    answerOf: (code) => COUNTRY_BY_CODE[code].name,
    isCorrect: (guess, code) => guess === code,
    suggest: () => [],
  },
};
