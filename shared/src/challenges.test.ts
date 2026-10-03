import { describe, expect, it } from 'vitest';
import {
  CHALLENGES,
  CHALLENGE_BY_ID,
  MEDAL_IDS,
  challengeCodes,
  challengeStanding,
  isCompletion,
  matchTyped,
  submitText,
  typeText,
  type Held,
  type TypingNotice,
  type TypingResult,
  medalForTime,
} from './challenges';
import { COUNTRIES } from './countries';

const europe = CHALLENGE_BY_ID.europe;
const pool = new Set(challengeCodes(europe));

describe('challenges', () => {
  it('covers every country once across the regional challenges, and all of them in the world one', () => {
    const regional = CHALLENGES.filter((c) => c.id !== 'world').flatMap(challengeCodes);
    expect(regional).toHaveLength(COUNTRIES.length);
    expect(new Set(regional).size).toBe(COUNTRIES.length);
    expect(challengeCodes(CHALLENGE_BY_ID.world)).toHaveLength(COUNTRIES.length);
  });

  it('gives harder medals less time', () => {
    for (const c of CHALLENGES) {
      expect(c.limits.bronze).toBeGreaterThan(c.limits.silver);
      expect(c.limits.silver).toBeGreaterThan(c.limits.gold);
    }
  });

  it('awards the best medal the time is good enough for', () => {
    expect(medalForTime(europe, 90_000)).toBe('gold');
    expect(medalForTime(europe, 120_000)).toBe('gold');
    expect(medalForTime(europe, 120_001)).toBe('silver');
    expect(medalForTime(europe, 9 * 60_000)).toBe('bronze');
    expect(medalForTime(europe, 11 * 60_000)).toBe(null);
  });

  it('lets a world medal count for every region', () => {
    const bests = { world: 14 * 60_000, europe: 4 * 60_000 }; // world silver, Europe silver
    expect(challengeStanding(CHALLENGE_BY_ID.africa, bests)).toEqual({ own: null, medal: 'silver', bestMs: null });
    expect(challengeStanding(europe, bests).medal).toBe('silver');
    expect(challengeStanding(europe, { ...bests, europe: 60_000 }).medal).toBe('gold');
    expect(challengeStanding(CHALLENGE_BY_ID.world, bests)).toEqual({ own: 'silver', medal: 'silver', bestMs: 14 * 60_000 });
    expect(MEDAL_IDS).toEqual(['bronze', 'silver', 'gold']);
  });

  it('only accepts complete runs within the bronze limit', () => {
    const all = [...pool];
    expect(isCompletion(europe, all, 100_000)).toBe(true);
    expect(isCompletion(europe, all.slice(1), 100_000)).toBe(false);
    expect(isCompletion(europe, all, europe.limits.bronze + 1)).toBe(false);
    expect(isCompletion(europe, all, 0)).toBe(false);
  });
});

describe('typing in a challenge', () => {
  const none = new Set<string>();

  it('enters a country as soon as it is spelled out, aliases and acronyms included', () => {
    expect(matchTyped('Franc', pool, none)).toEqual({ kind: 'none' });
    expect(matchTyped('france', pool, none)).toEqual({ kind: 'add', code: 'FR' });
    expect(matchTyped('the Netherlands', pool, none)).toEqual({ kind: 'add', code: 'NL' });
    expect(matchTyped('Czech Republic', pool, none)).toEqual({ kind: 'add', code: 'CZ' });
  });

  it('waits for Enter while the text is also the start of another country still to name', () => {
    expect(matchTyped('UK', pool, none)).toEqual({ kind: 'wait', code: 'GB' });
    expect(matchTyped('UK', pool, new Set(['UA']))).toEqual({ kind: 'add', code: 'GB' });
    const africa = new Set(challengeCodes(CHALLENGE_BY_ID.africa));
    expect(matchTyped('Niger', africa, none)).toEqual({ kind: 'wait', code: 'NE' });
    expect(matchTyped('Nigeria', africa, none)).toEqual({ kind: 'add', code: 'NG' });
    expect(matchTyped('Guinea', africa, none)).toEqual({ kind: 'wait', code: 'GN' });
    // An alias of the same country doesn't count as "another country".
    expect(matchTyped('Bosnia', pool, none)).toEqual({ kind: 'add', code: 'BA' });
  });

  it('tells repeats and countries of other regions apart', () => {
    expect(matchTyped('France', pool, new Set(['FR']))).toEqual({ kind: 'repeat', code: 'FR' });
    expect(matchTyped('Turkey', pool, none)).toEqual({ kind: 'outside', code: 'TR' });
  });
});

describe('typing session', () => {
  /** Types `keys` one character at a time (Enter as "\n"), like the input does. */
  function play(keys: string, codes: Set<string>) {
    let text = '';
    let held: Held | null = null;
    const found = new Set<string>();
    const notices: TypingNotice[] = [];
    for (const k of keys) {
      const r: TypingResult = k ==='\n' ? submitText(text, held, codes, found) : typeText(text + k, held, codes, found);
      r.added.forEach((c) => found.add(c));
      if (r.notice) notices.push(r.notice);
      text = r.text;
      held = r.held;
    }
    return { text, found: [...found], notices };
  }
  const africa = new Set(challengeCodes(CHALLENGE_BY_ID.africa));

  it('clears the input after each country', () => {
    expect(play('francespain', pool)).toEqual({ text: '', found: ['FR', 'ES'], notices: [] });
  });

  it('keeps a short name typed out to its long form, and splits off a new country', () => {
    expect(play('Bosnia and Herzegovina', pool)).toMatchObject({ text: '', found: ['BA'] });
    expect(play('BosniaAlbania', pool)).toMatchObject({ text: '', found: ['BA', 'AL'] });
  });

  it('enters Niger once the text clearly moves on, or on Enter, but never from "Nigeria"', () => {
    expect(play('Nigeria', africa)).toMatchObject({ text: '', found: ['NG'] });
    expect(play('NigerKenya', africa)).toMatchObject({ text: '', found: ['NE', 'KE'] });
    expect(play('Niger\n', africa)).toMatchObject({ text: '', found: ['NE'] });
    expect(play('Niger', africa)).toMatchObject({ text: 'Niger', found: [] });
  });

  it('flags misspellings on Enter, repeats and other regions right away', () => {
    expect(play('Frnace\n', pool)).toMatchObject({ text: 'Frnace', notices: [{ kind: 'unknown', text: 'Frnace' }] });
    expect(play('FranceFrance', pool)).toMatchObject({ text: '', notices: [{ kind: 'repeat', code: 'FR' }] });
    expect(play('Japan', pool)).toMatchObject({ text: '', notices: [{ kind: 'outside', code: 'JP' }] });
  });
});
