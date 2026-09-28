import { LANGUAGES, type Language } from './languages';
import { normalize } from './normalize';
import { SENTENCES, type Sentence } from './sentencesData';

export const LANGUAGE_BY_ID: Record<string, Language> = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

/** Only languages that have sentences are played. */
export const PLAYED_LANGUAGES: Language[] = LANGUAGES.filter((l) => SENTENCES[l.id]?.length);

/** Every sentence as a round item: "<language id>.<index>". */
export const SENTENCE_ITEMS: string[] = PLAYED_LANGUAGES.flatMap((l) => SENTENCES[l.id].map((_, i) => `${l.id}.${i}`));

export const languageOfItem = (item: string): string => item.slice(0, item.indexOf('.'));

export function sentenceOf(item: string): Sentence {
  const s = SENTENCES[languageOfItem(item)]?.[Number(item.slice(item.indexOf('.') + 1))];
  if (!s) throw new Error(`Unknown sentence ${item}`);
  return s;
}

// Normalized answer → the name to show for it. A form shared by two languages ("Chinese": Mandarin and
// Cantonese) resolves to that form itself, so a locked-in "Chinese" is shown as "Chinese".
const NAMES = new Map<string, { id: string | null; name: string }>();
for (const l of PLAYED_LANGUAGES) {
  for (const form of [l.name, ...l.aliases]) {
    const key = normalize(form);
    const had = NAMES.get(key);
    if (!had) NAMES.set(key, { id: l.id, name: l.name });
    else if (had.id !== l.id) NAMES.set(key, { id: null, name: form });
  }
}

/** Resolve free text to a language id (null if it names none, or more than one). */
export function resolveLanguage(input: string): string | null {
  return NAMES.get(normalize(input))?.id ?? null;
}

/** Display name for a typed language answer, or null if it names no language. */
export function languageNameOf(input: string): string | null {
  return NAMES.get(normalize(input))?.name ?? null;
}
