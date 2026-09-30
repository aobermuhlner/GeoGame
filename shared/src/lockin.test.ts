import { describe, expect, it } from 'vitest';
import { soloDraft, soloGuess, soloPoints, newDailyRun, dailyView, settleRun } from './daily';
import { applyDraft, applyGuess, applyPass, applyTimeout, decideMatch, newRound, pickStages, scoresOf, smallestPool } from './game';
import { LANDMARKS } from './landmarks';
import { LANDMARK_META } from './landmarkMeta';
import { landmarksInRegions, photoZoom, PHOTO_START_ZOOM } from './landmarkRules';
import { PLAYED_LANGUAGES, SENTENCE_ITEMS, languageOfItem, resolveLanguage } from './languageRules';
import { MODES } from './modes';
import { distanceKm, formatPin, parsePin, pinMissKm } from './pin';
import { REGION_IDS } from './regions';

const T0 = 1_000_000;
// Pins around the Eiffel Tower (48.858, 2.295)
const PARIS = '48.86,2.29,100'; // right, smallest circle: 5
const LONDON_500 = '51.5,-0.12,500'; // ~340 km off: right with 500 km: 3
const LONDON_250 = '51.5,-0.12,250'; // wrong

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

  it('is right when the landmark is inside the circle', () => {
    const m = MODES.landmarks;
    expect(m.isCorrect(PARIS, 'eiffel-tower')).toBe(true);
    expect(m.isCorrect(LONDON_500, 'eiffel-tower')).toBe(true);
    expect(m.isCorrect(LONDON_250, 'eiffel-tower')).toBe(false);
    expect(m.isCorrect('France', 'eiffel-tower')).toBe(false);
    expect(pinMissKm(LONDON_500, 'eiffel-tower')).toBeCloseTo(341, -1);
  });

  it('takes only pins with one of the offered radii', () => {
    const m = MODES.landmarks;
    expect(m.nameOf('France')).toBeNull();
    expect(m.nameOf('48.86,2.29,300')).toBeNull();
    expect(m.nameOf('95,2.29,100')).toBeNull();
    expect(m.nameOf('48.8612345,2.29,100')).toBe('48.861,2.290,100');
    expect(m.lockPoints!('1,1,100')).toBe(5);
    expect(m.lockPoints!('1,1,2000')).toBe(1);
  });

  it('pins round-trip and measure great-circle distance', () => {
    expect(formatPin(parsePin(' -33.857,151.215,250 ')!)).toBe('-33.857,151.215,250');
    expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(20015, -1);
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

  it('takes one answer per player and scores at the end: points by radius, first right +1', () => {
    const r = round();
    expect(applyGuess(r, 1, LONDON_500, T0 + 3000)).toBe('locked');
    expect(r.end).toBeNull();
    expect(applyGuess(r, 1, PARIS, T0 + 3500)).toBe('ignored'); // no second answer
    expect(applyGuess(r, 0, PARIS, T0 + 5000)).toBe('locked');
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([5, 4]);
    expect(r.winner).toBe(0);
  });

  it('refuses text that is no pin, so a stray message does not lock you in', () => {
    const r = round();
    expect(applyGuess(r, 0, 'France', T0 + 1000)).toBe('invalid');
    expect(r.locks?.[0] ?? null).toBeNull();
    expect(applyGuess(r, 0, PARIS, T0 + 2000)).toBe('locked');
  });

  it('a wrong answer scores nothing and counts as a wrong guess', () => {
    const r = round();
    applyGuess(r, 0, LONDON_250, T0 + 1000);
    applyGuess(r, 1, PARIS, T0 + 9000);
    expect(r.points).toEqual([0, 6]);
    expect(r.wrong).toEqual([1, 0]);
  });

  it('ends when the other player passes, and scores whoever locked in', () => {
    const r = round();
    applyGuess(r, 0, LONDON_500, T0 + 1000);
    expect(applyPass(r, 0, T0 + 1500)).toBe(false); // already locked in: can't pass
    expect(applyPass(r, 1, T0 + 2000)).toBe(true);
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([4, 0]);
  });

  it('times out with whatever was locked in', () => {
    const r = round();
    applyGuess(r, 1, PARIS, T0 + 1000);
    expect(applyTimeout(r, r.deadline)).toBe(true);
    expect(r.end).toBe('timeout');
    expect(r.points).toEqual([0, 6]);
  });

  it('match scores add up the lock-in points next to race rounds', () => {
    const a = round();
    applyGuess(a, 0, '48.86,2.29,2000', T0 + 1000);
    applyGuess(a, 1, '48.86,2.29,2000', T0 + 2000);
    const b = newRound('FR', T0, 'flags');
    applyGuess(b, 1, 'France', T0 + 1000);
    expect(scoresOf([a, b])).toEqual([2, 2]);
    expect(decideMatch([a, b]).decidedBy).toBe('draw');
  });

  it('a pin placed but not locked in counts when the time runs out, without the speed bonus', () => {
    const r = round();
    expect(r.deadline - r.startedAt).toBe(30_000);
    expect(applyDraft(r, 0, 'France', T0 + 500)).toBe(false);
    expect(applyDraft(r, 0, LONDON_250, T0 + 1000)).toBe(true);
    expect(applyDraft(r, 0, LONDON_500, T0 + 2000)).toBe(true); // the latest one counts
    expect(applyDraft(r, 1, PARIS, T0 + 1000)).toBe(true);
    applyGuess(r, 1, LONDON_500, T0 + 20_000); // locking in beats the draft
    expect(applyTimeout(r, r.deadline)).toBe(true);
    expect(r.locks?.[0]).toMatchObject({ answer: '51.500,-0.120,500', correct: true, auto: true });
    expect(r.points).toEqual([3, 4]);
    expect(applyDraft(r, 0, PARIS, r.deadline + 1)).toBe(false);
  });

  it('only auto-lock modes take drafts', () => {
    const item = SENTENCE_ITEMS.find((i) => languageOfItem(i) === 'spa')!;
    expect(applyDraft(newRound(item, T0, 'languages'), 0, 'Spanish', T0 + 1)).toBe(false);
  });

  it('languages: right = 1, first right +1', () => {
    const item = SENTENCE_ITEMS.find((i) => languageOfItem(i) === 'spa')!;
    const r = newRound(item, T0, 'languages');
    applyGuess(r, 1, 'Spanish', T0 + 3000);
    applyGuess(r, 0, 'Spanish', T0 + 5000);
    expect(r.points).toEqual([1, 2]);
  });
});

describe('solo lock-in', () => {
  it('one answer ends the round; wrong scores 0 and remembers the answer', () => {
    const run = newDailyRun('', 'landmarks', ['eiffel-tower', 'colosseum'], T0, 't');
    const start = run.rounds[0].startsAt;
    expect(soloGuess(run, 1, 'Italy', start + 1000)).toBe('invalid');
    expect(soloGuess(run, 1, LONDON_250, start + 2000)).toBe('wrong');
    const v = dailyView(run, start + 2000);
    expect(v.reveal?.end).toBe('wrong');
    expect(v.reveal?.given).toBe('51.500,-0.120,250');
    expect(v.reveal?.points).toBe(0);
    expect(v.reveal?.answer).toBe('Eiffel Tower');
    expect(v.reveal?.detail).toBe('France');
  });

  it('a placed pin counts at the deadline, with the points of a last-second answer', () => {
    const run = newDailyRun('', 'landmarks', ['eiffel-tower', 'colosseum'], T0, 't');
    const r = run.rounds[0];
    expect(soloDraft(run, 1, PARIS, r.startsAt + 1000)).toBe(true);
    expect(settleRun(run, r.deadline + 50)).toBe(true);
    expect(r.end).toBe('correct');
    expect(r.given).toBe('48.860,2.290,100');
    expect(r.points).toBe(soloPoints(30_000, 0, 30_000));
  });

  it('a bigger circle scores less', () => {
    const small = newDailyRun('', 'landmarks', ['eiffel-tower'], T0, 't');
    const big = newDailyRun('', 'landmarks', ['eiffel-tower'], T0, 't');
    const at = small.rounds[0].startsAt + 2000;
    expect(soloGuess(small, 1, PARIS, at)).toBe('correct');
    expect(soloGuess(big, 1, LONDON_500, at)).toBe('correct');
    expect(big.score).toBe(Math.round((small.score * 3) / 5));
  });

  it('shows the zoom focus while playing and the sentence as the prompt', () => {
    const lm = newDailyRun('', 'landmarks', ['eiffel-tower'], T0, 't');
    expect(dailyView(lm, lm.rounds[0].startsAt).focus).toEqual([0.5, 0.55]);
    const item = SENTENCE_ITEMS[0];
    const lang = newDailyRun('', 'languages', [item], T0, 't');
    expect(dailyView(lang, lang.rounds[0].startsAt).prompt).toBe(MODES.languages.promptText!(item));
  });
});
