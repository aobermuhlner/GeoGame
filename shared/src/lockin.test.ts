import { describe, expect, it } from 'vitest';
import { soloGuess, newDailyRun, dailyView } from './daily';
import { applyGuess, applyPass, applyTimeout, decideMatch, newRound, pickStages, scoresOf, smallestPool } from './game';
import { LANDMARKS } from './landmarks';
import { LANDMARK_META } from './landmarkMeta';
import { landmarksInRegions, photoZoom, PHOTO_START_ZOOM } from './landmarkRules';
import { PLAYED_LANGUAGES, SENTENCE_ITEMS, languageOfItem, resolveLanguage } from './languageRules';
import { MODES } from './modes';
import { REGION_IDS } from './regions';

const T0 = 1_000_000;

describe('landmarks data', () => {
  it('every landmark has a photo, credits and a unique id', () => {
    const ids = new Set(LANDMARKS.map((l) => l.id));
    expect(ids.size).toBe(LANDMARKS.length);
    for (const l of LANDMARKS) expect(LANDMARK_META[l.id]?.license).toBeTruthy();
  });

  it('has at least 10 landmarks in every region but the small ones together', () => {
    expect(landmarksInRegions(REGION_IDS).length).toBeGreaterThan(90);
    expect(landmarksInRegions(['europe']).length).toBeGreaterThanOrEqual(10);
    expect(landmarksInRegions(['central-america', 'caribbean']).length).toBeGreaterThanOrEqual(10);
  });

  it('zooms out from the start zoom to the full photo', () => {
    expect(photoZoom(0)).toBeCloseTo(PHOTO_START_ZOOM);
    expect(photoZoom(60_000)).toBe(1);
  });

  it('accepts the country (any alias), not the landmark', () => {
    const m = MODES.landmarks;
    expect(m.isCorrect('France', 'eiffel-tower')).toBe(true);
    expect(m.isCorrect('italy', 'eiffel-tower')).toBe(false);
    expect(m.isCorrect('USA', 'statue-of-liberty')).toBe(true);
    expect(m.nameOf('Eiffel Tower')).toBeNull();
  });
});

describe('languages data', () => {
  it('plays ~45 languages with several sentences each', () => {
    expect(PLAYED_LANGUAGES.length).toBeGreaterThanOrEqual(40);
    expect(SENTENCE_ITEMS.length).toBeGreaterThanOrEqual(PLAYED_LANGUAGES.length * 3);
  });

  it('accepts names and aliases; a shared alias is right for both', () => {
    const m = MODES.languages;
    const spa = SENTENCE_ITEMS.find((i) => languageOfItem(i) === 'spa')!;
    const yue = SENTENCE_ITEMS.find((i) => languageOfItem(i) === 'yue')!;
    expect(m.isCorrect('Spanish', spa)).toBe(true);
    expect(m.isCorrect('espanol', spa)).toBe(true);
    expect(m.isCorrect('Portuguese', spa)).toBe(false);
    expect(m.isCorrect('Chinese', yue)).toBe(true);
    expect(resolveLanguage('Chinese')).toBeNull(); // ambiguous
    expect(m.nameOf('Chinese')).toBe('Chinese');
    expect(m.nameOf('farsi')).toBe('Persian');
    expect(m.nameOf('Klingon')).toBeNull();
  });

  it('a game plays each language at most once', () => {
    const { codes } = pickStages(REGION_IDS, ['languages'], 10, () => 0.3);
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map(languageOfItem)).size).toBe(10);
  });

  it('ignores regions', () => {
    expect(smallestPool(['caribbean'], ['languages']).size).toBe(SENTENCE_ITEMS.length);
  });
});

describe('lock-in rounds', () => {
  const round = () => newRound('eiffel-tower', T0, 'landmarks');

  it('takes one answer per player and scores at the end: right = 1, first right +1', () => {
    const r = round();
    expect(applyGuess(r, 1, 'France', T0 + 3000)).toBe('locked');
    expect(r.end).toBeNull();
    expect(applyGuess(r, 1, 'Italy', T0 + 3500)).toBe('ignored'); // no second answer
    expect(applyGuess(r, 0, 'France', T0 + 5000)).toBe('locked');
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([1, 2]);
    expect(r.winner).toBe(1);
  });

  it('refuses text that names no country, so a typo does not lock you in', () => {
    const r = round();
    expect(applyGuess(r, 0, 'Frnace', T0 + 1000)).toBe('invalid');
    expect(r.locks?.[0] ?? null).toBeNull();
    expect(applyGuess(r, 0, 'France', T0 + 2000)).toBe('locked');
  });

  it('a wrong answer scores nothing and counts as a wrong guess', () => {
    const r = round();
    applyGuess(r, 0, 'Belgium', T0 + 1000);
    applyGuess(r, 1, 'France', T0 + 9000);
    expect(r.points).toEqual([0, 2]);
    expect(r.wrong).toEqual([1, 0]);
  });

  it('ends when the other player passes, and scores whoever locked in', () => {
    const r = round();
    applyGuess(r, 0, 'France', T0 + 1000);
    expect(applyPass(r, 0, T0 + 1500)).toBe(false); // already locked in: can't pass
    expect(applyPass(r, 1, T0 + 2000)).toBe(true);
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([2, 0]);
  });

  it('times out with whatever was locked in', () => {
    const r = round();
    applyGuess(r, 1, 'France', T0 + 1000);
    expect(applyTimeout(r, r.deadline)).toBe(true);
    expect(r.end).toBe('timeout');
    expect(r.points).toEqual([0, 2]);
  });

  it('match scores add up the lock-in points next to race rounds', () => {
    const a = round();
    applyGuess(a, 0, 'France', T0 + 1000);
    applyGuess(a, 1, 'France', T0 + 2000);
    const b = newRound('FR', T0, 'flags');
    applyGuess(b, 1, 'France', T0 + 1000);
    expect(scoresOf([a, b])).toEqual([2, 2]);
    expect(decideMatch([a, b]).decidedBy).toBe('draw');
  });
});

describe('solo lock-in', () => {
  it('one answer ends the round; wrong scores 0 and remembers the answer', () => {
    const run = newDailyRun('', 'landmarks', ['eiffel-tower', 'colosseum'], T0, 't');
    const start = run.rounds[0].startsAt;
    expect(soloGuess(run, 1, 'Frnace', start + 1000)).toBe('invalid');
    expect(soloGuess(run, 1, 'Italy', start + 2000)).toBe('wrong');
    const v = dailyView(run, start + 2000);
    expect(v.reveal?.end).toBe('wrong');
    expect(v.reveal?.given).toBe('Italy');
    expect(v.reveal?.points).toBe(0);
    expect(v.reveal?.detail).toBe('Eiffel Tower');
  });

  it('shows the zoom focus while playing and the sentence as the prompt', () => {
    const lm = newDailyRun('', 'landmarks', ['eiffel-tower'], T0, 't');
    expect(dailyView(lm, lm.rounds[0].startsAt).focus).toEqual([0.5, 0.55]);
    const item = SENTENCE_ITEMS[0];
    const lang = newDailyRun('', 'languages', [item], T0, 't');
    expect(dailyView(lang, lang.rounds[0].startsAt).prompt).toBe(MODES.languages.promptText!(item));
  });
});
