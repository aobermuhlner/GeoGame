// Higher or Lower: two countries, one statistic — pick the country with the higher value.
// Pure rules shared by the Accounts Durable Object (daily run), the Room (1 vs 1) and the browser.
import { COUNTRIES, COUNTRY_BY_CODE } from './countries';
import { COUNTDOWN_MS, type Slot, type MatchResult } from './game';
import { STAT_DATA } from './statsData';

export const STAT_IDS = [
  'population',
  'area',
  'density',
  'gdp',
  'gdpPerCapita',
  'lifeExpectancy',
  'forest',
  'urban',
  'fertility',
  'internet',
  'co2',
  'over65',
  'under15',
  'highestPoint',
] as const;

export type StatId = (typeof STAT_IDS)[number];

export interface Stat {
  /** Category name, e.g. "Forest cover" */
  label: string;
  /** The question shown above the two countries */
  question: string;
  icon: string;
  /** Value as displayed, e.g. "56%" or "83.5 million" */
  format: (v: number) => string;
  /** Where the numbers come from */
  source: string;
}

// Formatters are cached: building one per call makes pair picking (thousands of comparisons) slow.
const FORMATTERS = [0, 1, 2].map(
  (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
);
const num = (v: number, digits = 0) => FORMATTERS[digits].format(v);

/** 3 significant digits: "1.41", "83.5", "912" */
const sig3 = (v: number) => (v >= 100 ? num(Math.round(v)) : v >= 10 ? num(v, 1) : num(v, 2));

function people(v: number): string {
  if (v >= 1e9) return `${sig3(v / 1e9)} billion`;
  if (v >= 1e6) return `${sig3(v / 1e6)} million`;
  return num(v);
}

function dollars(v: number): string {
  if (v >= 1e12) return `$${sig3(v / 1e12)} trillion`;
  if (v >= 1e9) return `$${sig3(v / 1e9)} billion`;
  return `$${sig3(v / 1e6)} million`;
}

/** Whole percent from 10 % up, one decimal below. */
const pct = (v: number) => `${v >= 10 ? num(v) : num(v, 1)}%`;

const WB = (year: string | null) => `World Bank${year ? `, ${year}` : ''}`;
const year = (id: StatId) => STAT_DATA[id]?.year ?? null;

export const STATS: Record<StatId, Stat> = {
  population: {
    label: 'Population',
    question: 'Which country has more people?',
    icon: '👥',
    format: people,
    source: WB(year('population')),
  },
  area: {
    label: 'Area',
    question: 'Which country is bigger?',
    icon: '🗺️',
    format: (v) => `${v < 10 ? num(v, 2) : num(v)} km²`,
    source: WB(year('area')),
  },
  density: {
    label: 'Population density',
    question: 'Which country is more densely populated?',
    icon: '🏘️',
    format: (v) => `${v < 10 ? num(v, 1) : num(v)} per km²`,
    source: WB(year('density')),
  },
  gdp: {
    label: 'GDP',
    question: 'Which country has the bigger economy (GDP)?',
    icon: '💰',
    format: dollars,
    source: WB(year('gdp')),
  },
  gdpPerCapita: {
    label: 'GDP per person',
    question: 'Which country is richer per person?',
    icon: '💵',
    format: (v) => `$${num(v)}`,
    source: WB(year('gdpPerCapita')),
  },
  lifeExpectancy: {
    label: 'Life expectancy',
    question: 'Where do people live longer?',
    icon: '⏳',
    format: (v) => `${num(v, 1)} years`,
    source: WB(year('lifeExpectancy')),
  },
  forest: {
    label: 'Forest cover',
    question: 'Which country has more of its land covered by forest?',
    icon: '🌳',
    format: pct,
    source: WB(year('forest')),
  },
  urban: {
    label: 'Urban population',
    question: 'Where does a larger share of people live in cities?',
    icon: '🌆',
    format: pct,
    source: WB(year('urban')),
  },
  fertility: {
    label: 'Births per woman',
    question: 'Where do women have more children on average?',
    icon: '👶',
    format: (v) => `${num(v, 2)} children`,
    source: WB(year('fertility')),
  },
  internet: {
    label: 'Internet users',
    question: 'Where does a larger share of people use the internet?',
    icon: '🌐',
    format: pct,
    source: WB(year('internet')),
  },
  co2: {
    label: 'CO₂ per person',
    question: 'Which country emits more CO₂ per person?',
    icon: '🏭',
    format: (v) => `${num(v, 1)} t`,
    source: WB(year('co2')),
  },
  over65: {
    label: 'Aged 65 and over',
    question: 'Which country has the larger share of people aged 65+?',
    icon: '👵',
    format: pct,
    source: WB(year('over65')),
  },
  under15: {
    label: 'Children under 15',
    question: 'Which country has the larger share of children under 15?',
    icon: '🧒',
    format: pct,
    source: WB(year('under15')),
  },
  highestPoint: {
    label: 'Highest point',
    question: 'Whose highest mountain is higher?',
    icon: '🏔️',
    format: (v) => `${num(v)} m`,
    source: 'Wikipedia',
  },
};

export function statValue(stat: StatId, code: string): number | undefined {
  return STAT_DATA[stat]?.values[code];
}

/** Values closer than this (relative to the larger one) are too close to call and never paired. */
export const MIN_GAP = 0.02;

/**
 * Can `a` and `b` be asked in `stat`? Both need a value, and the values must differ clearly:
 * no ties, nothing that looks the same once formatted, nothing within MIN_GAP of each other.
 */
export function canPair(stat: StatId, a: string, b: string): boolean {
  const va = statValue(stat, a);
  const vb = statValue(stat, b);
  if (a === b || va === undefined || vb === undefined) return false;
  const f = STATS[stat].format;
  if (f(va) === f(vb)) return false;
  return Math.abs(va - vb) >= MIN_GAP * Math.max(Math.abs(va), Math.abs(vb));
}

export interface HigherPair {
  stat: StatId;
  a: string;
  b: string;
}

/** The country with the higher value (never a tie: canPair rules those out). */
export function higherOf(p: HigherPair): string {
  return statValue(p.stat, p.a)! > statValue(p.stat, p.b)! ? p.a : p.b;
}

/** How far apart the two values are (log ratio): big = easy, small = hard. */
export function pairGap(p: HigherPair): number {
  const va = statValue(p.stat, p.a)!;
  const vb = statValue(p.stat, p.b)!;
  return va > 0 && vb > 0 ? Math.abs(Math.log(va / vb)) : Math.abs(va - vb);
}

const ALL_CODES = COUNTRIES.map((c) => c.code);

/**
 * A random pair in `stat` from `pool`. Countries in `avoid` are skipped while enough others remain;
 * `usedPairs` ("AB" keys) are never asked again. Null if the pool has no valid pair at all.
 */
export function pickPair(
  stat: StatId,
  pool: readonly string[] = ALL_CODES,
  rng: () => number = Math.random,
  avoid: ReadonlySet<string> = new Set(),
  usedPairs: ReadonlySet<string> = new Set(),
): HigherPair | null {
  const withData = pool.filter((c) => statValue(stat, c) !== undefined);
  const fresh = withData.filter((c) => !avoid.has(c));
  for (const src of fresh.length >= 2 ? [fresh, withData] : [withData]) {
    // Random tries first (cheap), then an exhaustive scan so a small pool still finds its pairs.
    for (let i = 0; i < 60; i++) {
      const a = src[Math.floor(rng() * src.length)];
      const b = src[Math.floor(rng() * src.length)];
      if (canPair(stat, a, b) && !usedPairs.has(pairKey(a, b)))
        return rng() < 0.5 ? { stat, a, b } : { stat, a: b, b: a };
    }
    const all: HigherPair[] = [];
    for (let i = 0; i < src.length; i++)
      for (let j = i + 1; j < src.length; j++)
        if (canPair(stat, src[i], src[j]) && !usedPairs.has(pairKey(src[i], src[j])))
          all.push({ stat, a: src[i], b: src[j] });
    if (all.length) {
      const p = all[Math.floor(rng() * all.length)];
      return rng() < 0.5 ? p : { stat, a: p.b, b: p.a };
    }
  }
  return null;
}

export const pairKey = (a: string, b: string) => (a < b ? a + b : b + a);

export function shuffled<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Daily run ----------

export const HIGHER_ROUNDS = 15;
export const HIGHER_TIME_MS = 10_000;
/** How long the two values stay on screen after an answer */
export const HIGHER_REVEAL_MS = 2_500;

/**
 * Today's puzzle: one category and a chain of HIGHER_ROUNDS + 1 different countries. Each question brings in a
 * new country (a) against the previous question's new country (b), so every country but the first and the last
 * is asked twice. Early links are the clearest gaps of a random sample, later ones the closest calls.
 */
export function pickDailyHigher(stat: StatId, rng: () => number = Math.random): HigherPair[] {
  const pool = ALL_CODES.filter((c) => statValue(stat, c) !== undefined);
  let best: HigherPair[] = [];
  for (let attempt = 0; attempt < 20 && best.length < HIGHER_ROUNDS; attempt++) {
    let prev = pool[Math.floor(rng() * pool.length)];
    const used = new Set([prev]);
    const pairs: HigherPair[] = [];
    while (pairs.length < HIGHER_ROUNDS) {
      const options = pool.filter((c) => !used.has(c) && canPair(stat, c, prev));
      if (!options.length) break;
      const sample = shuffled(options, rng)
        .slice(0, 12)
        .map((c) => ({ c, gap: pairGap({ stat, a: c, b: prev }) }))
        .sort((x, y) => y.gap - x.gap);
      const k = Math.min(sample.length - 1, Math.floor((pairs.length / (HIGHER_ROUNDS - 1)) * sample.length));
      const next = sample[k].c;
      pairs.push({ stat, a: next, b: prev });
      used.add(next);
      prev = next;
    }
    if (pairs.length > best.length) best = pairs;
  }
  return best;
}

/** The category of the day: cycles through all categories, the order reshuffled per cycle. */
export function dailyStat(date: string): StatId {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const cycle = Math.floor(day / STAT_IDS.length);
  return shuffled(STAT_IDS, seeded(cycle))[day % STAT_IDS.length];
}

/** Small deterministic RNG (mulberry32). */
export function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type HigherEnd = 'correct' | 'wrong' | 'timeout';

export interface HigherSoloRound {
  startsAt: number;
  deadline: number;
  /** ISO code picked, null until answered (and on timeout) */
  pick: string | null;
  end: HigherEnd | null;
  endedAt: number | null;
}

export interface HigherRun {
  date: string;
  stat: StatId;
  pairs: HigherPair[];
  rounds: HigherSoloRound[];
  startedAt: number;
  finishedAt: number | null;
}

const soloRound = (startsAt: number): HigherSoloRound => ({
  startsAt,
  deadline: startsAt + HIGHER_TIME_MS,
  pick: null,
  end: null,
  endedAt: null,
});

export function newHigherRun(date: string, stat: StatId, pairs: HigherPair[], now: number): HigherRun {
  return { date, stat, pairs, rounds: [soloRound(now + COUNTDOWN_MS)], startedAt: now, finishedAt: null };
}

const lastOf = (run: HigherRun) => run.rounds[run.rounds.length - 1];

function endHigherRound(run: HigherRun, end: HigherEnd, now: number) {
  const r = lastOf(run);
  r.end = end;
  r.endedAt = now;
  if (run.rounds.length >= run.pairs.length) run.finishedAt = now;
}

/** Ends the current round if its time is up (a timeout is a mistake). Returns true if it changed. */
export function settleHigher(run: HigherRun, now: number): boolean {
  const r = lastOf(run);
  if (r.end || now < r.deadline) return false;
  endHigherRound(run, 'timeout', r.deadline);
  return true;
}

export type PickOutcome = 'correct' | 'wrong' | 'ignored';

/** `round` is 1-based and must be the current one; `code` one of the pair. Mutates `run`. */
export function higherPick(run: HigherRun, round: number, code: string, now: number): PickOutcome {
  settleHigher(run, now);
  const r = lastOf(run);
  const pair = run.pairs[run.rounds.length - 1];
  if (round !== run.rounds.length || r.end || now < r.startsAt || (code !== pair.a && code !== pair.b))
    return 'ignored';
  r.pick = code;
  const ok = code === higherOf(pair);
  endHigherRound(run, ok ? 'correct' : 'wrong', now);
  return ok ? 'correct' : 'wrong';
}

/** After round `round` ended, start the next one right away. Idempotent. Mutates `run`. */
export function higherNext(run: HigherRun, round: number, now: number): boolean {
  settleHigher(run, now);
  if (round !== run.rounds.length || !lastOf(run).end || run.rounds.length >= run.pairs.length) return false;
  run.rounds.push(soloRound(now));
  return true;
}

/** Correct answers before the first mistake — what the daily ranking is about. */
export function flawlessOf(ends: readonly (HigherEnd | null)[]): number {
  let n = 0;
  while (n < ends.length && ends[n] === 'correct') n++;
  return n;
}

export interface HigherScore {
  /** Correct answers in a row from the start */
  flawless: number;
  /** All correct answers (first tiebreaker) */
  correct: number;
  /** Time spent answering (second tiebreaker) */
  timeMs: number;
}

export function higherScore(run: HigherRun): HigherScore {
  const ended = run.rounds.filter((r) => r.end);
  return {
    flawless: flawlessOf(ended.map((r) => r.end)),
    correct: ended.filter((r) => r.end === 'correct').length,
    timeMs: ended.reduce((n, r) => n + Math.max(0, r.endedAt! - r.startsAt), 0),
  };
}

/** Negative if `a` ranks above `b`: longer flawless start, then more correct, then faster. */
export function compareHigher(a: HigherScore, b: HigherScore): number {
  return b.flawless - a.flawless || b.correct - a.correct || a.timeMs - b.timeMs;
}

// ---------- Views ----------

export interface PairView {
  stat: StatId;
  a: string;
  b: string;
  aName: string;
  bName: string;
}

export interface RevealedPair extends PairView {
  /** Values of a and b */
  values: [number, number];
  /** The country with the higher value */
  answer: string;
}

export const pairView = (p: HigherPair): PairView => ({
  stat: p.stat,
  a: p.a,
  b: p.b,
  aName: COUNTRY_BY_CODE[p.a].name,
  bName: COUNTRY_BY_CODE[p.b].name,
});

export const revealedPair = (p: HigherPair): RevealedPair => ({
  ...pairView(p),
  values: [statValue(p.stat, p.a)!, statValue(p.stat, p.b)!],
  answer: higherOf(p),
});

export interface HigherRoundView extends RevealedPair {
  pick: string | null;
  end: HigherEnd;
  timeMs: number | null;
}

export interface HigherRunView extends HigherScore {
  date: string;
  stat: StatId;
  phase: 'countdown' | 'playing' | 'reveal' | 'finished';
  /** 1-based current round */
  round: number;
  totalRounds: number;
  /** The pair to answer (phase 'playing' only — values stay hidden until it is answered) */
  pair: PairView | null;
  /** Value of pair.b when it was already revealed in the previous question (the chain's carried country) */
  known: number | null;
  /** Server-clock ms */
  startsAt: number;
  deadline: number | null;
  /** The round that just ended (phases 'reveal' and 'finished') */
  reveal: HigherRoundView | null;
  history: HigherRoundView[];
}

function higherRoundView(pair: HigherPair, r: HigherSoloRound): HigherRoundView {
  return {
    ...revealedPair(pair),
    pick: r.pick,
    end: r.end!,
    timeMs: r.pick !== null && r.endedAt !== null ? r.endedAt - r.startsAt : null,
  };
}

export function higherRunView(run: HigherRun, now: number): HigherRunView {
  const r = lastOf(run);
  const i = run.rounds.length - 1;
  const phase: HigherRunView['phase'] =
    run.finishedAt !== null ? 'finished' : r.end ? 'reveal' : now < r.startsAt ? 'countdown' : 'playing';
  return {
    date: run.date,
    stat: run.stat,
    phase,
    round: run.rounds.length,
    totalRounds: run.pairs.length,
    pair: phase === 'playing' ? pairView(run.pairs[i]) : null,
    known:
      phase === 'playing' && i > 0 && run.pairs[i].b === run.pairs[i - 1].a
        ? statValue(run.stat, run.pairs[i].b)!
        : null,
    startsAt: r.startsAt,
    deadline: r.end ? null : r.deadline,
    reveal: r.end ? higherRoundView(run.pairs[i], r) : null,
    history: run.rounds.flatMap((x, k) => (x.end ? [higherRoundView(run.pairs[k], x)] : [])),
    ...higherScore(run),
  };
}

// ---------- 1 vs 1 duel ----------

/** Regular rounds of a duel ("best of 10"); a tie after them goes to sudden death. */
export const DUEL_ROUNDS = 10;
/** Sudden-death rounds before the match is called a draw (practically never reached). */
export const DUEL_MAX_TIEBREAK = 20;
/** Time per duel round: a new category every round needs time to read */
export const DUEL_TIME_MS = 20_000;
/** The "Sudden death" announcement between round 10 and the first tiebreak round */
export const SUDDEN_DEATH_INTRO_MS = 4_000;

export interface DuelRound {
  pair: HigherPair;
  startedAt: number;
  deadline: number;
  /** Index = slot; null until that player picked */
  picks: [string | null, string | null];
  /** 'done': both picked · 'timeout': the clock ran out · 'forfeit': someone gave up / left */
  end: 'done' | 'timeout' | 'forfeit' | null;
  endedAt: number | null;
}

export function newDuelRound(pair: HigherPair, now: number): DuelRound {
  return { pair, startedAt: now, deadline: now + DUEL_TIME_MS, picks: [null, null], end: null, endedAt: null };
}

/**
 * The pair for the next duel round: categories rotate (each used once before any repeats),
 * countries from earlier rounds are avoided while the pool allows it, pairs never repeat.
 */
export function nextDuelPair(
  pool: readonly string[],
  rounds: readonly DuelRound[],
  rng: () => number = Math.random,
): HigherPair {
  const recent = rounds.slice(-(STAT_IDS.length - 1)).map((r) => r.pair.stat);
  const usedCodes = new Set(rounds.flatMap((r) => [r.pair.a, r.pair.b]));
  const usedPairs = new Set(rounds.map((r) => pairKey(r.pair.a, r.pair.b)));
  const stats = shuffled(STAT_IDS, rng).sort((x, y) => +recent.includes(x) - +recent.includes(y));
  for (const stat of stats) {
    const p = pickPair(stat, pool, rng, usedCodes, usedPairs);
    if (p) return p;
  }
  // Tiny pool, every pair used: allow repeats rather than stall.
  for (const stat of stats) {
    const p = pickPair(stat, pool, rng);
    if (p) return p;
  }
  throw new Error('No country pair available');
}

/** Lock in a pick (one per player, final). Returns true if accepted; ends the round once both picked. */
export function applyDuelPick(round: DuelRound, slot: Slot, code: string, now: number): boolean {
  if (round.end || round.picks[slot] !== null || now >= round.deadline) return false;
  if (code !== round.pair.a && code !== round.pair.b) return false;
  round.picks[slot] = code;
  if (round.picks[0] !== null && round.picks[1] !== null) {
    round.end = 'done';
    round.endedAt = now;
  }
  return true;
}

export function applyDuelTimeout(round: DuelRound, now: number): boolean {
  if (round.end || now < round.deadline) return false;
  round.end = 'timeout';
  round.endedAt = round.deadline;
  return true;
}

export const duelCorrect = (r: DuelRound, slot: Slot) => r.picks[slot] === higherOf(r.pair);

export function duelScores(rounds: readonly DuelRound[]): [number, number] {
  const s: [number, number] = [0, 0];
  for (const r of rounds) {
    if (r.end === null || r.end === 'forfeit') continue;
    if (duelCorrect(r, 0)) s[0]++;
    if (duelCorrect(r, 1)) s[1]++;
  }
  return s;
}

/** Wrong picks and timeouts per player. */
export function duelMisses(rounds: readonly DuelRound[]): [number, number] {
  const m: [number, number] = [0, 0];
  for (const r of rounds) {
    if (r.end === null || r.end === 'forfeit') continue;
    if (!duelCorrect(r, 0)) m[0]++;
    if (!duelCorrect(r, 1)) m[1]++;
  }
  return m;
}

/**
 * Is the duel decided after its ended rounds? All DUEL_ROUNDS are always played; tied after them,
 * sudden death goes on until exactly one player is right in a round.
 */
export function duelOver(rounds: readonly DuelRound[]): boolean {
  const n = rounds.filter((r) => r.end).length;
  const [a, b] = duelScores(rounds);
  if (n < DUEL_ROUNDS) return false;
  return a !== b || n >= DUEL_ROUNDS + DUEL_MAX_TIEBREAK;
}

export function decideDuel(rounds: readonly DuelRound[], forfeitedBy: Slot | null = null): MatchResult {
  const scores = duelScores(rounds);
  const wrongTotals = duelMisses(rounds);
  if (forfeitedBy !== null) return { winner: forfeitedBy === 0 ? 1 : 0, scores, wrongTotals, decidedBy: 'forfeit' };
  if (scores[0] === scores[1]) return { winner: null, scores, wrongTotals, decidedBy: 'draw' };
  const suddenDeath = rounds.filter((r) => r.end).length > DUEL_ROUNDS;
  return {
    winner: scores[0] > scores[1] ? 0 : 1,
    scores,
    wrongTotals,
    decidedBy: suddenDeath ? 'tiebreaker' : 'points',
  };
}

export interface DuelRoundView extends RevealedPair {
  picks: [string | null, string | null];
  correct: [boolean, boolean];
  /** A sudden-death round */
  tiebreak: boolean;
  end: 'done' | 'timeout' | 'forfeit';
}

export interface DuelView {
  /** 1-based number of the current round (0 before the first) */
  round: number;
  regularRounds: number;
  /** The current round is sudden death */
  tiebreak: boolean;
  /** Pair being played (hidden values); null during countdowns */
  pair: PairView | null;
  /** Who has locked in this round */
  picked: [boolean, boolean];
  /** Your own pick this round (filled in per receiver) */
  mine: string | null;
  /** The round that just ended (phase 'reveal') */
  reveal: DuelRoundView | null;
  history: DuelRoundView[];
}

export function duelRoundView(r: DuelRound, index: number): DuelRoundView {
  return {
    ...revealedPair(r.pair),
    picks: [r.picks[0], r.picks[1]],
    correct: [duelCorrect(r, 0), duelCorrect(r, 1)],
    tiebreak: index >= DUEL_ROUNDS,
    end: r.end ?? 'forfeit',
  };
}
