import { COUNTRIES, type Country } from './countries';

/**
 * Canonical form used for comparing guesses: lower case, no accents, no
 * punctuation, "&" → "and", "st" → "saint", leading "the" dropped.
 */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\bst\b/g, 'saint')
    .replace(/^the /, '');
}

/** All normalized strings accepted for a country. */
export function acceptedForms(country: Country): string[] {
  return [country.name, ...country.aliases].map(normalize);
}

const LOOKUP = new Map<string, string>();
for (const c of COUNTRIES) {
  for (const form of acceptedForms(c)) {
    const existing = LOOKUP.get(form);
    if (existing && existing !== c.code) throw new Error(`Alias clash: "${form}" (${existing}/${c.code})`);
    LOOKUP.set(form, c.code);
  }
}

/** Resolve free text to an ISO code, or null if it names no known country. */
export function resolveGuess(input: string): string | null {
  return LOOKUP.get(normalize(input)) ?? null;
}

/** True if `guess` names the country with ISO code `answerCode`. */
export function isCorrectGuess(guess: string, answerCode: string): boolean {
  return resolveGuess(guess) === answerCode;
}
