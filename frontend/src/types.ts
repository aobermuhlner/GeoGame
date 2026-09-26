import type { ForfeitReason, GuessOutcome, MatchResult, ModeId, RankedView, RegionId, RoundEnd, Slot } from '@flagduel/shared';

export interface PlayerVM {
  name: string;
  score: number;
  wrongTotal: number;
  passed: boolean;
  connected: boolean;
  /** Accepted a rematch */
  rematch: boolean;
  /** Local-clock time by which a disconnected player must be back */
  graceEndsAt: number | null;
  /** Left for good */
  left: boolean;
}

export interface RoundSummary {
  mode: ModeId;
  flagUrl: string;
  /** ISO code of the answer */
  code: string;
  countryName: string;
  /** What had to be typed (country or capital) */
  answer: string;
  winner: Slot | null;
  wrong: [number, number];
  end: RoundEnd;
}

/** Everything the game/results screens need. Built by the mock or from server messages. */
export interface GameVM {
  phase: 'countdown' | 'playing' | 'reveal' | 'finished';
  me: Slot;
  players: [PlayerVM, PlayerVM];
  /** 1-based index of the current round over the whole match */
  round: number;
  totalRounds: number;
  /** Minigames of this match, in play order */
  modes: ModeId[];
  /** 0-based index into `modes` of the minigame being played or about to start */
  stage: number;
  /** 1-based round within the current minigame (0 during its countdown) */
  stageRound: number;
  stageRounds: number;
  /** Country name shown with the flag (capitals), else null */
  prompt: string | null;
  flagUrl: string | null;
  /** Local-clock ms timestamps */
  countdownEndsAt: number | null;
  deadline: number | null;
  regions: RegionId[];
  reveal: { mode: ModeId; code: string; countryName: string; answer: string; winner: Slot | null; end: RoundEnd } | null;
  /** Increments on every wrong guess by the opponent (drives the ✗ flash). */
  oppWrongSeq: number;
  history: RoundSummary[];
  result: MatchResult | null;
  forfeitReason: ForfeitReason | null;
  /** Ranked match info (absent for friend lobbies and the bot demo) */
  ranked?: RankedView | null;
}

export interface GameActions {
  guess(text: string): Promise<GuessOutcome> | GuessOutcome;
  pass(): void;
  giveUp(): void;
  rematch(): void;
  leave(): void;
}
