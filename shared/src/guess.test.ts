import { describe, expect, it } from 'vitest';
import { COUNTRY_BY_CODE } from './countries';
import { newDailyRun, soloGuess, settleRun } from './daily';
import { applyGuess, applyPass, newRound, roundTimeOf } from './game';
import {
  GUESS_BY_ID,
  GUESS_QUESTIONS,
  GUESS_TIME_MS,
  accuracyOf,
  canonicalText,
  duelEstimatePoints,
  guessPool,
  parseCanonical,
  parseGuessPrompt,
  topicOf,
} from './guess';
import { groupGuess, newGroupRound } from './group';
import { MODES } from './modes';
import { pickStages } from './game';
import { REGION_IDS } from './regions';
import { IMPERIAL, METRIC, formatQuantity, fromUserUnit, parseEstimate, toUserUnit } from './units';
import { topPercent } from './api';

describe('question bank', () => {
  it('has valid, unique questions', () => {
    const ids = new Set<string>();
    for (const q of GUESS_QUESTIONS) {
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
      expect(Number.isFinite(q.answer)).toBe(true);
      expect(q.text.endsWith('?') || q.text.endsWith(')')).toBe(true);
      expect(q.source).toBeTruthy();
      if (q.country) expect(COUNTRY_BY_CODE[q.country]).toBeDefined();
    }
    expect(GUESS_QUESTIONS.length).toBeGreaterThan(500);
  });

  it('leaves out countries whose population, area and density disagree', () => {
    // The World Bank lists Monaco at 75 km² (it is about 2 km²): not asked. Monaco isn't in the stat countries
    // anyway, so check the rule on a well-known one instead.
    expect(GUESS_BY_ID['s.area.MC']).toBeUndefined();
    expect(GUESS_BY_ID['s.population.BR']?.answer).toBeGreaterThan(200e6);
  });

  it('pools by region and keeps a game varied', () => {
    const europe = guessPool(['europe']);
    expect(europe).toContain('f.equator'); // world-wide facts are always in
    expect(europe).toContain('f.matterhorn');
    expect(europe).not.toContain('f.denali');
    const { codes } = pickStages(REGION_IDS, ['guess'], 10);
    expect(new Set(codes.map(topicOf)).size).toBe(10);
  });
});

describe('estimates', () => {
  it('parses what people type', () => {
    expect(parseEstimate('8849', 'elevation')).toBe(8849);
    expect(parseEstimate('8,849', 'elevation')).toBe(8849);
    expect(parseEstimate('8.849', 'elevation')).toBe(8849);
    expect(parseEstimate('8 849 m', 'elevation')).toBe(8849);
    expect(parseEstimate('1,5', 'children')).toBe(1.5);
    expect(parseEstimate('2.35', 'children')).toBe(2.35);
    expect(parseEstimate('1.234.567', 'people')).toBe(1234567);
    expect(parseEstimate('1,234.5', 'people')).toBe(1234.5);
    expect(parseEstimate('1.234,5', 'people')).toBe(1234.5);
    expect(parseEstimate('212m', 'people')).toBe(212e6);
    expect(parseEstimate('1.4 billion', 'people')).toBe(1.4e9);
    expect(parseEstimate('3k', 'count')).toBe(3000);
    expect(parseEstimate('−89', 'temperature')).toBe(-89);
    expect(parseEstimate('-89.2 °C', 'temperature')).toBe(-89.2);
    expect(parseEstimate('450 BC', 'year')).toBe(-450);
    expect(parseEstimate('71%', 'percent')).toBe(71);
    expect(parseEstimate('$13k', 'usd')).toBe(13000);
    expect(parseEstimate('hello', 'count')).toBeNull();
    expect(parseEstimate('12 apples', 'count')).toBeNull();
    expect(parseEstimate('', 'count')).toBeNull();
  });

  it('converts units both ways', () => {
    expect(toUserUnit('temperature', 100, IMPERIAL)).toBeCloseTo(212);
    expect(fromUserUnit('temperature', -40, IMPERIAL)).toBeCloseTo(-40);
    expect(toUserUnit('elevation', 1609.344, IMPERIAL)).toBeCloseTo(5280);
    expect(fromUserUnit('length', 1, IMPERIAL)).toBeCloseTo(1.609344);
    expect(fromUserUnit('area', 1, IMPERIAL)).toBeCloseTo(2.58999);
    expect(toUserUnit('people', 5, IMPERIAL)).toBe(5);
    expect(formatQuantity('elevation', 8849, METRIC)).toBe('8,849 m');
    expect(formatQuantity('elevation', 8849, IMPERIAL)).toBe('29,032 ft');
    expect(formatQuantity('temperature', 56.7, IMPERIAL)).toBe('134.1 °F');
    expect(formatQuantity('people', 212_812_405, METRIC)).toBe('213 million people');
    expect(formatQuantity('year', -450, METRIC)).toBe('450 BC');
  });

  it('scores closeness the same in every unit', () => {
    const everest = GUESS_BY_ID['f.everest'];
    expect(accuracyOf(everest, 8849)).toBe(1);
    expect(accuracyOf(everest, 8000)).toBeGreaterThan(0.9);
    expect(accuracyOf(everest, 3000)).toBeLessThan(0.05);
    expect(accuracyOf(everest, -5)).toBe(0);
    // 29,000 ft typed by an American ≈ 8,839 m.
    expect(accuracyOf(everest, fromUserUnit('elevation', 29000, IMPERIAL))).toBeGreaterThan(0.99);
    const hottest = GUESS_BY_ID['f.hottest'];
    expect(accuracyOf(hottest, 46.7)).toBeCloseTo(0.5);
    expect(accuracyOf(hottest, fromUserUnit('temperature', 134, IMPERIAL))).toBeGreaterThan(0.99);
  });

  it('sends canonical numbers', () => {
    expect(canonicalText(8848.953600001)).toBe('8848.9536');
    expect(parseCanonical('8848.9536')).toBe(8848.9536);
    expect(parseCanonical('-89.2')).toBe(-89.2);
    expect(parseCanonical('1e20')).toBeNull();
    expect(parseCanonical('abc')).toBeNull();
    expect(MODES.guess.nameOf('8849')).toBe('8849');
    expect(MODES.guess.nameOf('8,849')).toBeNull();
  });

  it('hides the question id in the prompt', () => {
    const p = MODES.guess.promptText!('f.everest');
    expect(p).not.toContain('everest');
    expect(parseGuessPrompt(p)).toEqual({ quantity: 'elevation', text: 'How high is Mount Everest?' });
  });

  it('shows the top percentage', () => {
    expect(topPercent(1, 200)).toBe(1);
    expect(topPercent(50, 200)).toBe(25);
    expect(topPercent(3, 3)).toBe(100);
    expect(topPercent(1, 1)).toBeNull();
    expect(topPercent(null, 10)).toBeNull();
  });
});

describe('playing GeoGuesser', () => {
  const T0 = 1_000_000;

  it('duels: the closer estimate scores, a spot-on one twice', () => {
    expect(duelEstimatePoints([0.95, 0.6])).toEqual([2, 0]);
    expect(duelEstimatePoints([0.5, 0.6])).toEqual([0, 1]);
    expect(duelEstimatePoints([0.7, 0.7])).toEqual([1, 1]);
    expect(duelEstimatePoints([0, null])).toEqual([0, 0]);
    expect(duelEstimatePoints([0.3, null])).toEqual([1, 0]);

    const r = newRound('f.everest', T0, 'guess');
    expect(r.deadline - T0).toBe(GUESS_TIME_MS);
    expect(roundTimeOf('guess')).toBe(GUESS_TIME_MS);
    expect(applyGuess(r, 0, 'eight thousand', T0 + 1000)).toBe('invalid');
    expect(applyGuess(r, 0, '8800', T0 + 1000)).toBe('locked');
    expect(r.end).toBeNull();
    expect(applyGuess(r, 1, '7000', T0 + 2000)).toBe('locked');
    expect(r.end).toBe('locked');
    expect(r.points).toEqual([2, 0]);
    expect(r.winner).toBe(0);
    expect(r.wrong).toEqual([0, 1]);
    expect(r.locks![0]!.correct).toBe(true);
  });

  it('duels: an estimate against a pass still scores', () => {
    const r = newRound('f.everest', T0, 'guess');
    applyGuess(r, 1, '5000', T0 + 1000);
    expect(applyPass(r, 0, T0 + 2000)).toBe(true);
    expect(r.points).toEqual([0, 1]);
  });

  it('daily: points for accuracy, not speed', () => {
    const run = newDailyRun('2026-09-30', 'guess', ['f.everest', 'f.nile'], T0, 'tok');
    const start = run.rounds[0].startsAt;
    expect(run.rounds[0].deadline - start).toBe(GUESS_TIME_MS);
    expect(soloGuess(run, 1, '8849', start + 25_000)).toBe('correct');
    expect(run.rounds[0].points).toBe(100);
    run.rounds.push({ ...run.rounds[0], code: 'f.nile', startsAt: T0 + 60_000, deadline: T0 + 90_000, end: null, endedAt: null, points: 0 });
    delete run.rounds[1].given;
    delete run.rounds[1].accuracy;
    expect(soloGuess(run, 2, '2000', T0 + 61_000)).toBe('wrong');
    expect(run.rounds[1].points).toBeGreaterThan(0);
    expect(run.rounds[1].points).toBeLessThan(50);
    expect(run.score).toBe(100 + run.rounds[1].points);
    expect(settleRun(run, T0 + 200_000)).toBe(false);
  });

  it('group: everyone scores by accuracy', () => {
    const r = newGroupRound('guess', 'f.hottest', null, 3, T0);
    expect(r.deadline - T0).toBe(GUESS_TIME_MS);
    expect(groupGuess(r, 0, '56.7', T0 + 1000)).toBe('locked');
    expect(groupGuess(r, 1, '46.7', T0 + 29_000)).toBe('locked');
    expect(groupGuess(r, 2, 'hot', T0 + 1000)).toBe('invalid');
    expect(r.entries[0].points).toBe(100);
    expect(r.entries[1].points).toBe(50);
    expect(r.entries[1].end).toBe('correct');
  });
});
