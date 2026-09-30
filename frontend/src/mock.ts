// Local, backend-free simulation of a match against a bot. Dev-only: flag files
// here are named by ISO code, which is exactly what the real server avoids.
import {
  COUNTDOWN_MS,
  LANDMARK_META,
  MATCH_INTRO_MS,
  PIN_RADII,
  MODES,
  roundTimeOf,
  STAGE_INTRO_MS,
  applyGuess,
  applyPass,
  applyTimeout,
  decideMatch,
  destination,
  formatPin,
  focusOf,
  itemInfo,
  newRound,
  pickStages,
  revealMsOf,
  roundPoints,
  scoresOf,
  stageAt,
  type Lock,
  type ModeId,
  type RegionId,
  type RoundState,
  type Slot,
} from '@flagduel/shared';
import { WORKER_URL } from './net';
import type { GameActions, GameVM, RoundSummary } from './types';

function flagUrl(mode: ModeId, code: string): string {
  // Landmark photos come from the Worker's practice route (run the Worker for those).
  if (MODES[mode].prompt === 'photo') return `${WORKER_URL}/practice/landmarks/${code}`;
  return `/dev-flags/${code.toLowerCase()}.svg`;
}

function summary(x: RoundState): RoundSummary {
  const mode = x.mode ?? 'flags';
  return {
    mode,
    flagUrl: flagUrl(mode, x.code),
    code: x.code,
    ...itemInfo(mode, x.code),
    winner: x.winner,
    wrong: [...x.wrong],
    points: roundPoints(x),
    locks: x.locks ? [lockView(x.locks[0]), lockView(x.locks[1])] : null,
    end: x.end!,
  };
}

const lockView = (l: Lock | null) => (l ? { answer: l.answer, correct: l.correct, accuracy: l.accuracy ?? null } : null);

export function startMockGame(opts: {
  name: string;
  botName: string;
  regions: RegionId[];
  modes: ModeId[];
  /** 'lazy': the bot never answers correctly and passes late (handy for testing). */
  bot?: 'normal' | 'lazy';
  onUpdate: (vm: GameVM) => void;
}): GameActions & { dispose(): void } {
  let codes: string[] = [];
  let roundModes: ModeId[] = [];
  let rounds: RoundState[] = [];
  let current = -1;
  let phase: GameVM['phase'] = 'countdown';
  let countdownEndsAt: number | null = null;
  let forfeitedBy: Slot | null = null;
  let oppWrongSeq = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  function emit() {
    const r = rounds[current];
    const scores = scoresOf(rounds);
    const wrong = rounds.reduce<[number, number]>((w, x) => [w[0] + x.wrong[0], w[1] + x.wrong[1]], [0, 0]);
    const ended = rounds.filter((x) => x.end);
    const counting = phase === 'countdown';
    const stage = stageAt(roundModes, counting ? current + 1 : current);
    const mode = r?.mode ?? 'flags';
    const present = { connected: true, rematch: false, graceEndsAt: null, left: false };
    opts.onUpdate({
      phase,
      me: 0,
      players: [
        { name: opts.name, score: scores[0], wrongTotal: wrong[0], passed: !!r?.passed[0], locked: !!r?.locks?.[0], ...present },
        { name: opts.botName, score: scores[1], wrongTotal: wrong[1], passed: !!r?.passed[1], locked: !!r?.locks?.[1], ...present },
      ],
      round: Math.max(1, current + 1),
      totalRounds: codes.length,
      modes: opts.modes,
      stage: stage.stage,
      stageRound: counting ? 0 : current - stage.start + 1,
      stageRounds: stage.rounds,
      prompt: r && !counting ? (MODES[mode].promptText?.(r.code) ?? null) : null,
      flagUrl: r && !counting ? flagUrl(mode, r.code) : null,
      focus: r && !counting && MODES[mode].prompt === 'photo' ? focusOf(r.code) : null,
      myLock: r && !r.end ? (r.locks?.[0]?.answer ?? null) : null,
      countdownEndsAt,
      deadline: r && !r.end ? r.deadline : null,
      regions: opts.regions,
      reveal: r?.end && phase === 'reveal' ? summary(r) : null,
      oppWrongSeq,
      history: ended.map(summary),
      result: phase === 'finished' ? decideMatch(rounds, forfeitedBy) : null,
      forfeitReason: forfeitedBy === null ? null : 'gaveUp',
    });
  }

  function start() {
    clearTimers();
    ({ codes, roundModes } = pickStages(opts.regions, opts.modes));
    rounds = [];
    current = -1;
    forfeitedBy = null;
    oppWrongSeq = 0;
    phase = 'countdown';
    countdownEndsAt = Date.now() + MATCH_INTRO_MS + COUNTDOWN_MS;
    later(MATCH_INTRO_MS + COUNTDOWN_MS, () => startRound(0));
    emit();
  }

  function startRound(i: number) {
    current = i;
    countdownEndsAt = null;
    const r = newRound(codes[i], Date.now(), roundModes[i]);
    rounds[i] = r;
    phase = 'playing';
    later(roundTimeOf(roundModes[i]) + 5, () => {
      if (applyTimeout(r, Date.now())) finishRound();
    });
    scheduleBot(r);
    emit();
  }

  function scheduleBot(r: RoundState) {
    const lazy = opts.bot === 'lazy';
    const knows = !lazy && Math.random() < 0.55;
    const m = MODES[r.mode ?? 'flags'];
    const time = roundTimeOf(r.mode ?? 'flags');
    if (m.lockIn) {
      // One answer: the right one if it knows, else a plausible wrong one (estimates: off by up to ×2 either way).
      later(lazy ? time - 2000 : 3000 + Math.random() * 12000, () => {
        if (r.end || r !== rounds[current]) return;
        const guess =
          m.input === 'pin'
            ? botPin(r.code, knows)
            : m.input === 'number'
              ? String(Math.round(Number(m.answerOf(r.code)) * (lazy ? 7 : 2 ** (Math.random() * 2 - 1))))
            : knows
              ? m.answerOf(r.code)
              : m.prompt === 'sentence'
                ? 'Latin'
                : 'Atlantis';
        const out = applyGuess(r, 1, guess, Date.now());
        if (out === 'invalid' && applyPass(r, 1, Date.now())) finishRound();
        else if (r.end) finishRound();
        emit();
      });
      return;
    }
    const wrongs = Math.floor(Math.random() * 3);
    for (let k = 0; k < wrongs; k++) {
      later(2000 + Math.random() * 7000, () => {
        if (r.end || r !== rounds[current]) return;
        if (applyGuess(r, 1, 'Atlantis', Date.now()) === 'wrong') oppWrongSeq++;
        if (r.end) finishRound(); // both out of tries (map modes)
        emit();
      });
    }
    const decideAt = lazy ? time - 2000 : knows ? 4000 + Math.random() * 10000 : 8000 + Math.random() * 8000;
    later(decideAt, () => {
      if (r.end || r !== rounds[current]) return;
      if (knows) {
        const m = MODES[r.mode ?? 'flags'];
        const answer = m.input === 'map' ? r.code : m.answerOf(r.code);
        if (applyGuess(r, 1, answer, Date.now()) === 'correct' || r.end) finishRound();
      } else if (applyPass(r, 1, Date.now())) finishRound();
      emit();
    });
  }

  function finishRound() {
    clearTimers();
    phase = 'reveal';
    emit();
    later(revealMsOf(roundModes[current]), () => {
      if (current + 1 >= codes.length) {
        phase = 'finished';
        emit();
      } else if (roundModes[current + 1] !== roundModes[current]) {
        phase = 'countdown';
        countdownEndsAt = Date.now() + STAGE_INTRO_MS;
        later(STAGE_INTRO_MS, () => startRound(current + 1));
        emit();
      } else startRound(current + 1);
    });
  }

  start();

  return {
    guess(text) {
      const r = rounds[current];
      if (!r || phase !== 'playing') return 'ignored';
      const outcome = applyGuess(r, 0, text, Date.now());
      if (outcome === 'correct' || r.end) finishRound();
      else emit();
      return outcome;
    },
    pass() {
      const r = rounds[current];
      if (!r || phase !== 'playing') return;
      if (applyPass(r, 0, Date.now())) finishRound();
      else emit();
    },
    giveUp() {
      clearTimers();
      const r = rounds[current];
      if (r && !r.end) {
        r.end = 'forfeit';
        r.endedAt = Date.now();
      }
      forfeitedBy = 0;
      phase = 'finished';
      emit();
    },
    rematch: start,
    leave: clearTimers,
    dispose: clearTimers,
  };
}

/** Landmarks: a pin some way off the spot (far off if the bot doesn't know it), with a random circle. */
function botPin(landmark: string, knows: boolean): string {
  const m = LANDMARK_META[landmark];
  const off = knows ? Math.random() * 400 : 800 + Math.random() * 3000;
  const [lat, lon] = destination(m?.lat ?? 0, m?.lon ?? 0, off, Math.random() * 360);
  const km = PIN_RADII[Math.floor(Math.random() * PIN_RADII.length)];
  return formatPin({ lat, lon, km });
}
