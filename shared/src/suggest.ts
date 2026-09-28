import { CAPITALS } from './capitals';
import { COUNTRIES } from './countries';
import { PLAYED_LANGUAGES } from './languageRules';
import { normalize } from './normalize';

interface Entry {
  name: string;
  nameForm: string;
  aliasForms: string[];
}

function wordStartMatch(form: string, q: string): boolean {
  const words = form.split(' ');
  for (let i = 1; i < words.length; i++) {
    if (words.slice(i).join(' ').startsWith(q)) return true;
  }
  return false;
}

/**
 * Build an autocomplete over a fixed list of answers.
 * Ranking: exact name/alias match, name prefix, alias prefix, then a match at the
 * start of a later word ("ba" → Bahamas … Barbados, then Antigua and Barbuda).
 */
function makeSuggester(items: readonly { name: string; aliases: string[] }[]) {
  const entries: Entry[] = items
    .map((c) => ({ name: c.name, nameForm: normalize(c.name), aliasForms: c.aliases.map(normalize) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (query: string, limit = 6): string[] => {
    const q = normalize(query);
    if (!q) return [];
    const buckets: string[][] = [[], [], [], []];
    for (const e of entries) {
      const forms = [e.nameForm, ...e.aliasForms];
      if (forms.includes(q)) buckets[0].push(e.name);
      else if (e.nameForm.startsWith(q)) buckets[1].push(e.name);
      else if (e.aliasForms.some((f) => f.startsWith(q))) buckets[2].push(e.name);
      else if (forms.some((f) => wordStartMatch(f, q))) buckets[3].push(e.name);
    }
    return buckets.flat().slice(0, limit);
  };
}

/** Autocomplete over ALL countries (never filtered by region — that would be a hint). */
export const suggestCountries = makeSuggester(COUNTRIES);

/** Autocomplete over ALL capitals (never filtered by region). */
export const suggestCapitals = makeSuggester(CAPITALS);

/** Autocomplete over every language that is played. */
export const suggestLanguages = makeSuggester(PLAYED_LANGUAGES);
