// Languages game: read a sentence, name its language. The single place to edit the list.
// The ~30 most spoken languages (Ethnologue, total speakers; Arabic varieties counted as one) plus a few
// well-known ones. English is left out (the game is in English, so it would be a free point).
// Sentences come from Tatoeba (CC BY 2.0 FR): after editing, run `node shared/scripts/fetch-sentences.mjs`,
// which writes sentencesData.ts.

export interface Language {
  /** ISO 639-3 code, as used by Tatoeba */
  id: string;
  name: string;
  /** Other accepted answers (matched after normalization) */
  aliases: string[];
}

// [id, name, ...aliases]
const RAW: [string, string, ...string[]][] = [
  // Most spoken
  ['cmn', 'Mandarin Chinese', 'Chinese', 'Mandarin', 'Putonghua'],
  ['hin', 'Hindi'],
  ['spa', 'Spanish', 'Castilian', 'Espanol'],
  ['ara', 'Arabic'],
  ['fra', 'French', 'Francais'],
  ['ben', 'Bengali', 'Bangla'],
  ['por', 'Portuguese', 'Portugues'],
  ['rus', 'Russian'],
  ['ind', 'Indonesian', 'Bahasa Indonesia'],
  ['urd', 'Urdu'],
  ['deu', 'German', 'Deutsch'],
  ['jpn', 'Japanese'],
  ['mar', 'Marathi'],
  ['vie', 'Vietnamese'],
  ['tel', 'Telugu'],
  ['hau', 'Hausa'],
  ['tur', 'Turkish'],
  ['pan', 'Punjabi', 'Panjabi'],
  ['swh', 'Swahili', 'Kiswahili'],
  ['tgl', 'Tagalog', 'Filipino'],
  ['tam', 'Tamil'],
  ['yue', 'Cantonese', 'Yue', 'Cantonese Chinese', 'Chinese'],
  ['pes', 'Persian', 'Farsi'],
  ['kor', 'Korean'],
  ['tha', 'Thai'],
  ['jav', 'Javanese'],
  ['ita', 'Italian', 'Italiano'],
  ['guj', 'Gujarati'],
  ['amh', 'Amharic'],
  ['kan', 'Kannada'],
  // Well known
  ['nld', 'Dutch', 'Flemish', 'Nederlands'],
  ['pol', 'Polish'],
  ['ukr', 'Ukrainian'],
  ['ell', 'Greek'],
  ['swe', 'Swedish'],
  ['nob', 'Norwegian', 'Norwegian Bokmal', 'Bokmal'],
  ['dan', 'Danish'],
  ['fin', 'Finnish'],
  ['hun', 'Hungarian', 'Magyar'],
  ['ces', 'Czech'],
  ['ron', 'Romanian'],
  ['heb', 'Hebrew'],
  ['zul', 'Zulu', 'isiZulu'],
  ['yor', 'Yoruba'],
  ['lat', 'Latin'],
];

export const LANGUAGES: Language[] = RAW.map(([id, name, ...aliases]) => ({ id, name, aliases }));
