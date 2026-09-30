// GeoGuesser: estimate a number (a height, a distance, a temperature, a population…). The closer, the more points.
// Pure rules shared by the Worker (daily, duels, group games) and the browser (practice, display).
import { COUNTRY_BY_CODE } from './countries';
import { FAME_TIERS } from './fame';
import { GUESS_FACTS } from './guessFacts';
import type { RegionId } from './regions';
import { STAT_DATA } from './statsData';
import { QUANTITIES, type Quantity } from './units';

/** Time per round: numbers take longer to think about than a flag. */
export const GUESS_TIME_MS = 30_000;
/** The reveal shows the answer, everyone's estimate and how far off it was. */
export const GUESS_REVEAL_MS = 6_000;
/** Points for a perfect estimate (solo and group games) */
export const GUESS_MAX_POINTS = 100;
/** An estimate this accurate counts as "spot on" (a bonus point in duels, 🎯 everywhere) */
export const SPOT_ON = 0.9;
/** An estimate at least this accurate counts as a hit (✓) in the round lists */
export const GOOD_ESTIMATE = 0.5;

export interface GuessQuestion {
  /** 'f.everest' (hand-picked fact) or 's.population.BR' (country statistic) */
  id: string;
  topic: string;
  quantity: Quantity;
  /** In the quantity's canonical unit (see units.ts) */
  answer: number;
  text: string;
  country: string | null;
  note: string | null;
  source: string;
}

// ---------- Questions from the country statistics ----------

/** "the United States", "the Netherlands" — names that take an article in a sentence. */
const THE = new Set(['US', 'GB', 'NL', 'PH', 'AE']);
const nameIn = (code: string) => `${THE.has(code) ? 'the ' : ''}${COUNTRY_BY_CODE[code].name}`;
const possessive = (code: string) => {
  const n = nameIn(code);
  return n.endsWith('s') ? `${n}’` : `${n}’s`;
};

/** Statistics that make good estimation questions, with the question for a country. */
const STAT_QUESTIONS: Record<string, { quantity: Quantity; text: (code: string) => string }> = {
  population: { quantity: 'people', text: (c) => `How many people live in ${nameIn(c)}?` },
  area: { quantity: 'area', text: (c) => `How large is ${nameIn(c)}?` },
  density: { quantity: 'density', text: (c) => `How densely populated is ${nameIn(c)}? (people per area)` },
  gdpPerCapita: { quantity: 'usd', text: (c) => `What is the GDP per person of ${nameIn(c)}, in US dollars?` },
  lifeExpectancy: { quantity: 'years', text: (c) => `What is the life expectancy at birth in ${nameIn(c)}?` },
  forest: { quantity: 'percent', text: (c) => `What share of ${possessive(c)} land is covered by forest?` },
  urban: { quantity: 'percent', text: (c) => `What share of ${possessive(c)} people live in cities?` },
  fertility: { quantity: 'children', text: (c) => `How many children does a woman in ${nameIn(c)} have on average?` },
  over65: { quantity: 'percent', text: (c) => `What share of ${possessive(c)} population is 65 or older?` },
  highestPoint: { quantity: 'elevation', text: (c) => `How high is the highest point of ${nameIn(c)}?` },
};

/**
 * Countries asked about: the 80 best-known ones (fame tiers Bronze and Silver), minus Palestine (the sources
 * disagree on what its figures cover).
 */
const STAT_COUNTRIES = FAME_TIERS.slice(0, 2)
  .flatMap((t) => t.split(/\s+/).filter(Boolean))
  .filter((c) => c !== 'PS');

/** Single values left out because the answer is disputed (Italy's side of Mont Blanc: 4,748 m or 4,806 m). */
const DISPUTED = new Set(['highestPoint.IT']);

/**
 * Population, area and density must agree (population ÷ area ≈ density within 15 %). Where they don't, one of
 * the source values is off (the World Bank lists Monaco at 75 km², for one), so none of the three is asked.
 */
function consistent(code: string): boolean {
  const pop = STAT_DATA.population?.values[code];
  const area = STAT_DATA.area?.values[code];
  const density = STAT_DATA.density?.values[code];
  if (pop === undefined || area === undefined || density === undefined || area <= 0) return false;
  return Math.abs(Math.log(pop / area / density)) < Math.log(1.15);
}

function statQuestions(): GuessQuestion[] {
  const out: GuessQuestion[] = [];
  for (const [stat, q] of Object.entries(STAT_QUESTIONS)) {
    const data = STAT_DATA[stat];
    if (!data) continue;
    for (const code of STAT_COUNTRIES) {
      const v = data.values[code];
      const country = COUNTRY_BY_CODE[code];
      if (v === undefined || !country || v <= 0 || DISPUTED.has(`${stat}.${code}`)) continue;
      if (['population', 'area', 'density'].includes(stat) && !consistent(code)) continue;
      out.push({
        id: `s.${stat}.${code}`,
        topic: `stat:${stat}`,
        quantity: q.quantity,
        answer: v,
        text: q.text(code),
        country: code,
        note: null,
        source: stat === 'highestPoint' ? 'Wikipedia' : `World Bank${data.year ? `, ${data.year}` : ''}`,
      });
    }
  }
  return out;
}

export const GUESS_QUESTIONS: GuessQuestion[] = [
  ...GUESS_FACTS.map((f) => ({
    id: `f.${f.id}`,
    topic: f.topic,
    quantity: f.quantity,
    answer: f.answer,
    text: f.text,
    country: f.country,
    note: f.note ?? null,
    source: f.source,
  })),
  ...statQuestions(),
];

export const GUESS_BY_ID: Record<string, GuessQuestion> = Object.fromEntries(GUESS_QUESTIONS.map((q) => [q.id, q]));

/**
 * Questions for the selected regions: world-wide facts always, the rest when their country is in a region.
 * Hand-picked facts and country statistics are both in; `topicOf` keeps a game varied.
 */
export function guessPool(regions: readonly RegionId[]): string[] {
  const set = new Set(regions);
  return GUESS_QUESTIONS.filter((q) => !q.country || set.has(COUNTRY_BY_CODE[q.country]?.region)).map((q) => q.id);
}

export const topicOf = (id: string): string => GUESS_BY_ID[id]?.topic ?? id;

// ---------- Scoring ----------

type Tolerance = { scale: 'log'; factor: number } | { scale: 'linear'; spread: number };

/**
 * How far off an estimate may be before it scores nothing. Amounts that span orders of magnitude are judged by
 * ratio (a population off by a factor of `factor` scores 0: with 5, 25 % off scores 86, twice or half 57),
 * bounded ones by difference (`spread`).
 */
export function toleranceOf(q: Pick<GuessQuestion, 'quantity' | 'answer'>): Tolerance {
  switch (q.quantity) {
    case 'people':
    case 'area':
    case 'density':
    case 'usd':
      return { scale: 'log', factor: 5 };
    case 'count':
    case 'length':
      return { scale: 'log', factor: 4 };
    case 'elevation':
      return { scale: 'log', factor: 3 };
    case 'percent':
      // Small shares are about the order of magnitude (2.5 % vs 10 % is a big miss).
      return q.answer < 10 ? { scale: 'log', factor: 5 } : { scale: 'linear', spread: 30 };
    case 'temperature':
      return { scale: 'linear', spread: 20 };
    case 'year':
      return { scale: 'linear', spread: q.answer >= 1800 ? 40 : 150 };
    case 'years':
    case 'degrees':
      return { scale: 'linear', spread: 15 };
    case 'children':
      return { scale: 'linear', spread: 2.5 };
  }
}

/** 0 (way off) … 1 (exact). Both numbers in the canonical unit. */
export function accuracyOf(q: Pick<GuessQuestion, 'quantity' | 'answer'>, estimate: number): number {
  if (!Number.isFinite(estimate)) return 0;
  const t = toleranceOf(q);
  if (t.scale === 'log') {
    if (estimate <= 0 || q.answer <= 0) return estimate === q.answer ? 1 : 0;
    return Math.max(0, 1 - Math.abs(Math.log(estimate / q.answer)) / Math.log(t.factor));
  }
  return Math.max(0, 1 - Math.abs(estimate - q.answer) / t.spread);
}

export const estimatePoints = (accuracy: number): number => Math.round(GUESS_MAX_POINTS * accuracy);

/** Accuracy of an answer as sent (the canonical number as text) to question `id`; 0 if either is unknown. */
export function guessAccuracy(answer: string, id: string): number {
  const q = GUESS_BY_ID[id];
  const v = parseCanonical(answer);
  return q && v !== null ? accuracyOf(q, v) : 0;
}

/**
 * How far off an estimate is, for the reveal: "+12%" / "−40%" by ratio, "+3.5" by difference for linear
 * quantities (in the canonical unit; the browser converts temperature differences itself).
 */
export function offBy(q: Pick<GuessQuestion, 'quantity' | 'answer'>, estimate: number): { ratio: number | null; diff: number } {
  return { ratio: q.answer !== 0 ? estimate / q.answer - 1 : null, diff: estimate - q.answer };
}

// ---------- Wire format ----------

/** Answers travel as the canonical number in plain text ("8849", "-89.2"). Null for anything else. */
export function parseCanonical(text: string): number | null {
  if (typeof text !== 'string' || !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(text.trim())) return null;
  const v = Number(text);
  return Number.isFinite(v) && Math.abs(v) < 1e15 ? v : null;
}

/** An estimate as it is stored and shown to others (a few decimals at most). */
export function canonicalText(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * The round's prompt while it runs: the quantity and the question text, not the question id (the id would
 * name the statistic and country, handy for looking the answer up).
 */
export const guessPrompt = (id: string): string => {
  const q = GUESS_BY_ID[id];
  return q ? `${q.quantity}|${q.text}` : '';
};

export function parseGuessPrompt(prompt: string): { quantity: Quantity; text: string } | null {
  const i = prompt.indexOf('|');
  const quantity = prompt.slice(0, i) as Quantity;
  if (i < 0 || !(QUANTITIES as readonly string[]).includes(quantity)) return null;
  return { quantity, text: prompt.slice(i + 1) };
}

// ---------- Duels ----------

/** Duel points for a round: the closer estimate 1 (both on a tie), a spot-on estimate 1 more. */
export function duelEstimatePoints(accuracies: readonly (number | null)[]): number[] {
  const given = accuracies.filter((a): a is number => a !== null && a > 0);
  const best = given.length ? Math.max(...given) : null;
  return accuracies.map((a) => (a === null || a <= 0 ? 0 : (a === best ? 1 : 0) + (a >= SPOT_ON ? 1 : 0)));
}
