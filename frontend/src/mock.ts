// Local, backend-free simulation of a match against a bot. Dev-only: flag files
// here are named by ISO code, which is exactly what the real server avoids.
import {
  COUNTDOWN_MS,
  COUNTRY_BY_CODE,
  MODES,
  REVEAL_MS,
  ROUND_TIME_MS,
  STAGE_INTRO_MS,
  applyGuess,
  applyPass,
  applyTimeout,
  decideMatch,
  newRound,
  pickStages,
  scoresOf,
  stageAt,
  type ModeId,
  type RegionId,
  type RoundState,
  type Slot,
} from '@flagduel/shared';
import type { GameActions, GameVM } from './types';

function flagUrl(code: string): string {
  return `/dev-flags/${code.toLowerCase()}.svg`;
}

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
        { name: opts.name, score: scores[0], wrongTotal: wrong[0], passed: !!r?.passed[0], ...present },
        { name: opts.botName, score: scores[1], wrongTotal: wrong[1], passed: !!r?.passed[1], ...present },
      ],
      round: Math.max(1, current + 1),
      totalRounds: codes.length,
      modes: opts.modes,
      stage: stage.stage,
      stageRound: counting ? 0 : current - stage.start + 1,
      stageRounds: stage.rounds,
      prompt: r && !counting && MODES[mode].showsCountry ? COUNTRY_BY_CODE[r.code].name : null,
      flagUrl: r && !counting ? flagUrl(r.code) : null,
      countdownEndsAt,
      deadline: r && !r.end ? r.deadline : null,
      regions: opts.regions,
      reveal:
        r?.end && phase === 'reveal'
          ? {
              mode,
              code: r.code,
              countryName: COUNTRY_BY_CODE[r.code].name,
              answer: MODES[mode].answerOf(r.code),
              winner: r.winner,
              end: r.end,
            }
          : null,
      oppWrongSeq,
      history: ended.map((x) => ({
        mode: x.mode ?? 'flags',
        flagUrl: flagUrl(x.code),
        code: x.code,
        countryName: COUNTRY_BY_CODE[x.code].name,
        answer: MODES[x.mode ?? 'flags'].answerOf(x.code),
        winner: x.winner,
        wrong: [...x.wrong],
        end: x.end!,
      })),
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
    countdownEndsAt = Date.now() + COUNTDOWN_MS;
    later(COUNTDOWN_MS, () => startRound(0));
    emit();
  }

  function startRound(i: number) {
    current = i;
    countdownEndsAt = null;
    const r = newRound(codes[i], Date.now(), roundModes[i]);
    rounds[i] = r;
    phase = 'playing';
    later(ROUND_TIME_MS + 5, () => {
      if (applyTimeout(r, Date.now())) finishRound();
    });
    scheduleBot(r);
    emit();
  }

  function scheduleBot(r: RoundState) {
    const lazy = opts.bot === 'lazy';
    const knows = !lazy && Math.random() < 0.55;
    const wrongs = Math.floor(Math.random() * 3);
    for (let k = 0; k < wrongs; k++) {
      later(2000 + Math.random() * 7000, () => {
        if (r.end || r !== rounds[current]) return;
        if (applyGuess(r, 1, 'Atlantis', Date.now()) === 'wrong') oppWrongSeq++;
        if (r.end) finishRound(); // both out of tries (map modes)
        emit();
      });
    }
    const decideAt = lazy ? ROUND_TIME_MS - 2000 : knows ? 4000 + Math.random() * 10000 : 8000 + Math.random() * 8000;
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
    later(REVEAL_MS, () => {
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
