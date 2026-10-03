// Languages game: trivia shown on the reveal — where the language is spoken most, and how many countries
// have it as an official or national language (country level; state or regional status doesn't count).
import { COUNTRY_BY_CODE } from './countries';

export interface LanguageFacts {
  /** Up to five places with the most speakers, most first: ISO codes, or a name for places that aren't countries */
  spokenIn: string[];
  /** Countries where it is an official or national language */
  official: number;
  /** Official in a state or region (e.g. an Indian state), though in no country as a whole */
  regional?: true;
}

export const LANGUAGE_FACTS: Record<string, LanguageFacts> = {
  cmn: { spokenIn: ['CN', 'TW', 'MY', 'SG', 'US'], official: 3 },
  hin: { spokenIn: ['IN', 'NP', 'FJ', 'MU'], official: 2 },
  spa: { spokenIn: ['MX', 'US', 'CO', 'ES', 'AR'], official: 20 },
  ara: { spokenIn: ['EG', 'SD', 'DZ', 'IQ', 'MA'], official: 23 },
  fra: { spokenIn: ['FR', 'CD', 'DZ', 'MA', 'CM'], official: 29 },
  ben: { spokenIn: ['BD', 'IN'], official: 1 },
  por: { spokenIn: ['BR', 'AO', 'MZ', 'PT'], official: 9 },
  rus: { spokenIn: ['RU', 'UA', 'KZ', 'BY', 'UZ'], official: 4 },
  ind: { spokenIn: ['ID'], official: 1 },
  urd: { spokenIn: ['PK', 'IN'], official: 1 },
  deu: { spokenIn: ['DE', 'AT', 'CH', 'BR', 'US'], official: 6 },
  jpn: { spokenIn: ['JP', 'BR', 'US'], official: 1 },
  mar: { regional: true, spokenIn: ['IN'], official: 0 },
  vie: { spokenIn: ['VN', 'US', 'KH', 'AU', 'FR'], official: 1 },
  tel: { regional: true, spokenIn: ['IN', 'US'], official: 0 },
  hau: { spokenIn: ['NG', 'NE', 'GH', 'CM', 'TD'], official: 1 },
  tur: { spokenIn: ['TR', 'DE', 'BG', 'CY'], official: 2 },
  pan: { regional: true, spokenIn: ['PK', 'IN', 'CA', 'GB', 'US'], official: 0 },
  swh: { spokenIn: ['TZ', 'KE', 'CD', 'UG', 'RW'], official: 5 },
  tgl: { spokenIn: ['PH', 'US'], official: 1 },
  tam: { spokenIn: ['IN', 'LK', 'MY', 'SG'], official: 2 },
  yue: { regional: true, spokenIn: ['CN', 'Hong Kong', 'Macau', 'MY', 'US'], official: 0 },
  pes: { spokenIn: ['IR', 'AF', 'TJ'], official: 3 },
  kor: { spokenIn: ['KR', 'KP', 'CN', 'US', 'JP'], official: 2 },
  tha: { spokenIn: ['TH'], official: 1 },
  jav: { spokenIn: ['ID', 'MY', 'SR'], official: 0 },
  ita: { spokenIn: ['IT', 'CH', 'SM'], official: 4 },
  guj: { regional: true, spokenIn: ['IN', 'GB', 'US'], official: 0 },
  amh: { spokenIn: ['ET'], official: 1 },
  kan: { regional: true, spokenIn: ['IN'], official: 0 },
  nld: { spokenIn: ['NL', 'BE', 'SR'], official: 3 },
  pol: { spokenIn: ['PL', 'GB', 'DE', 'US'], official: 1 },
  ukr: { spokenIn: ['UA', 'RU', 'PL'], official: 1 },
  ell: { spokenIn: ['GR', 'CY'], official: 2 },
  swe: { spokenIn: ['SE', 'FI'], official: 2 },
  nob: { spokenIn: ['NO'], official: 1 },
  dan: { spokenIn: ['DK', 'DE'], official: 1 },
  fin: { spokenIn: ['FI', 'SE'], official: 1 },
  hun: { spokenIn: ['HU', 'RO', 'SK', 'RS', 'UA'], official: 1 },
  ces: { spokenIn: ['CZ', 'SK'], official: 1 },
  ron: { spokenIn: ['RO', 'MD'], official: 2 },
  heb: { spokenIn: ['IL'], official: 1 },
  zul: { spokenIn: ['ZA', 'LS', 'SZ'], official: 1 },
  yor: { spokenIn: ['NG', 'BJ', 'TG'], official: 0 },
  lat: { spokenIn: ['VA'], official: 1 },
};

/** "Spoken in Mexico, United States, … (official in 20 countries)", or null for a language without facts. */
export function languageFactsLine(langId: string): string | null {
  const f = LANGUAGE_FACTS[langId];
  if (!f) return null;
  const places = f.spokenIn.map((p) => COUNTRY_BY_CODE[p]?.name ?? p).join(', ');
  const status =
    f.official === 0
      ? f.regional
        ? 'official only regionally'
        : 'not official in any country'
      : `official in ${f.official} ${f.official === 1 ? 'country' : 'countries'}`;
  return `${langId === 'lat' ? 'Used in' : 'Spoken in'} ${places} (${status})`;
}
