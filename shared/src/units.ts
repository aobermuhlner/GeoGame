// Quantities of the GeoGuesser game: how answers are converted, parsed and displayed.
// Answers travel and are scored in one canonical unit per quantity (°C, km, m, km²), so players who pick
// different units play the very same question. Only the browser converts, for typing and for display.

export const QUANTITIES = [
  'temperature',
  'length',
  'elevation',
  'area',
  'density',
  'people',
  'count',
  'percent',
  'year',
  'years',
  'children',
  'usd',
  'degrees',
] as const;

export type Quantity = (typeof QUANTITIES)[number];

/** Quantities that can be shown in another unit, and their choices (the first one is canonical). */
export const UNIT_CHOICES = {
  temperature: ['C', 'F'],
  length: ['km', 'mi'],
  elevation: ['m', 'ft'],
  area: ['km2', 'mi2'],
} as const;

export type ConvertibleQuantity = keyof typeof UNIT_CHOICES;
export type UnitPrefs = { [Q in ConvertibleQuantity]: (typeof UNIT_CHOICES)[Q][number] };

export const METRIC: UnitPrefs = { temperature: 'C', length: 'km', elevation: 'm', area: 'km2' };
export const IMPERIAL: UnitPrefs = { temperature: 'F', length: 'mi', elevation: 'ft', area: 'mi2' };

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;
const KM2_PER_MI2 = KM_PER_MI * KM_PER_MI;

/** Which of the user's preferences a quantity follows (population density follows area). */
export function prefKeyOf(q: Quantity): ConvertibleQuantity | null {
  if (q === 'density') return 'area';
  return q in UNIT_CHOICES ? (q as ConvertibleQuantity) : null;
}

const isImperial = (q: Quantity, prefs: UnitPrefs) => {
  const k = prefKeyOf(q);
  return k !== null && prefs[k] !== UNIT_CHOICES[k][0];
};

/** Canonical value → the value in the user's unit. */
export function toUserUnit(q: Quantity, v: number, prefs: UnitPrefs): number {
  if (!isImperial(q, prefs)) return v;
  switch (q) {
    case 'temperature':
      return (v * 9) / 5 + 32;
    case 'length':
      return v / KM_PER_MI;
    case 'elevation':
      return v / M_PER_FT;
    case 'area':
      return v / KM2_PER_MI2;
    case 'density':
      return v * KM2_PER_MI2;
    default:
      return v;
  }
}

/** A value typed in the user's unit → canonical. */
export function fromUserUnit(q: Quantity, v: number, prefs: UnitPrefs): number {
  if (!isImperial(q, prefs)) return v;
  switch (q) {
    case 'temperature':
      return ((v - 32) * 5) / 9;
    case 'length':
      return v * KM_PER_MI;
    case 'elevation':
      return v * M_PER_FT;
    case 'area':
      return v * KM2_PER_MI2;
    case 'density':
      return v / KM2_PER_MI2;
    default:
      return v;
  }
}

/** Unit label shown next to the input and the numbers ("" for plain counts). */
export function unitLabel(q: Quantity, prefs: UnitPrefs): string {
  const imp = isImperial(q, prefs);
  switch (q) {
    case 'temperature':
      return imp ? '°F' : '°C';
    case 'length':
      return imp ? 'mi' : 'km';
    case 'elevation':
      return imp ? 'ft' : 'm';
    case 'area':
      return imp ? 'mi²' : 'km²';
    case 'density':
      return imp ? 'per mi²' : 'per km²';
    case 'percent':
      return '%';
    case 'years':
      return 'years';
    case 'children':
      return 'children';
    case 'usd':
      return 'US$';
    case 'degrees':
      return '°';
    case 'people':
      return 'people';
    default:
      return '';
  }
}

const FORMATS = [0, 1, 2].map((d) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d }));

/** A readable number: grouped thousands, "1.41 billion" for huge ones, a decimal or two for small ones. */
export function formatNumber(v: number): string {
  const a = Math.abs(v);
  const sig3 = (x: number) => FORMATS[x >= 100 ? 0 : x >= 10 ? 1 : 2].format(x);
  if (a >= 1e12) return `${sig3(v / 1e12)} trillion`;
  if (a >= 1e9) return `${sig3(v / 1e9)} billion`;
  if (a >= 1e6) return `${sig3(v / 1e6)} million`;
  if (a >= 100) return FORMATS[0].format(v);
  if (a >= 10) return FORMATS[1].format(v);
  return FORMATS[2].format(v);
}

/** Canonical value → "29,032 ft", "56.7 °C", "212 million people", "$13,862". */
export function formatQuantity(q: Quantity, v: number, prefs: UnitPrefs): string {
  const u = toUserUnit(q, v, prefs);
  switch (q) {
    case 'year':
      return u < 0 ? `${Math.round(-u)} BC` : String(Math.round(u));
    case 'usd':
      return `$${formatNumber(u)}`;
    case 'percent':
      return `${formatNumber(u)}%`;
    case 'temperature':
      return `${FORMATS[1].format(u)} ${unitLabel(q, prefs)}`;
    case 'degrees':
      return `${FORMATS[1].format(u)}°`;
    case 'count':
      return formatNumber(u);
    default:
      return `${formatNumber(u)} ${unitLabel(q, prefs)}`;
  }
}

const MULTIPLIERS: [RegExp, number][] = [
  [/^(k|thousand|thousands|tsd|tausend)$/, 1e3],
  [/^(m|mn|mio|mill?|million|millions)$/, 1e6],
  [/^(b|bn|bil|billion|billions|mrd|milliarden?)$/, 1e9],
  [/^(t|tn|trillion|trillions)$/, 1e12],
];

/** Unit words a player may type after the number (ignored: the unit comes from the toggle). */
const UNIT_WORDS = /^(°?[cf]|°|km2?|km²|mi2?|mi²|miles?|m|ft|feet|foot|meters?|metres?|people|persons?|years?|yrs?|children|kids|%|percent|usd|us\$|\$|dollars?|per ?km2?|per ?km²|per ?mi2?|per ?mi²|\/km2?|\/km²|\/mi2?|\/mi²|ad|ce)$/;

/**
 * A typed estimate → number (in the unit it was typed in), or null. Accepts "1,234", "1 234", "1.234,5",
 * "1,5", "−12", "3.2k", "1.4 billion", "8849 m" and "450 BC" (a negative year).
 */
export function parseEstimate(input: string, q: Quantity): number | null {
  let s = input.trim().toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ');
  if (!s) return null;
  let bc = false;
  const bcMatch = /\s*(bc|bce|v\.? ?chr\.?)$/.exec(s);
  if (bcMatch && q === 'year') {
    bc = true;
    s = s.slice(0, bcMatch.index);
  }
  const m = /^([+-]?)\s*\$?\s*([0-9][0-9.,' ]*)\s*(.*)$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  let digits = m[2].trim().replace(/[' ]/g, '');
  const suffix = m[3].trim();
  let mult = 1;
  if (suffix) {
    const hit = MULTIPLIERS.find(([re]) => re.test(suffix));
    // "m" after a height or distance means metres/miles, not million.
    const unitFirst = (q === 'elevation' || q === 'length') && /^(m|mi)$/.test(suffix);
    if (hit && !unitFirst) mult = hit[1];
    else if (!UNIT_WORDS.test(suffix)) return null;
  }
  const commas = (digits.match(/,/g) ?? []).length;
  const dots = (digits.match(/\./g) ?? []).length;
  if (commas && dots) {
    // The later separator is the decimal one: "1,234.5" or "1.234,5".
    const decimal = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    digits = digits.split(thousands).join('').replace(decimal, '.');
  } else if (commas || dots) {
    const sep = commas ? ',' : '.';
    const parts = digits.split(sep);
    // "1,234" / "1.234.567": groups of three are thousands; "1,5" / "3.25" is a decimal.
    const grouped = parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0');
    if (parts.length > 2 && !parts.slice(1).every((p) => p.length === 3)) return null;
    // A dot followed by exactly three digits is still read as a decimal if a multiplier follows ("1.234 billion").
    digits = grouped && !(sep === '.' && mult > 1) ? parts.join('') : parts.join('.');
  }
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const v = sign * Number(digits) * mult * (bc ? -1 : 1);
  return Number.isFinite(v) ? v : null;
}
