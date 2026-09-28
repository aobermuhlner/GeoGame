import type {
  DuelView,
  ForfeitReason,
  GameId,
  GuessOutcome,
  LockView,
  MatchResult,
  ModeId,
  RankedView,
  RegionId,
  RoundEnd,
  Slot,
} from '@flagduel/shared';

export interface PlayerVM {
  name: string;
  score: number;
  wrongTotal: number;
  passed: boolean;
  /** Lock-in games: has locked in an answer this round */
  locked: boolean;
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
  /** Flag or landmark photo */
  flagUrl: string;
  /** The round's item (ISO code, landmark id or sentence id) */
  code: string;
  /** Country it is about (null for languages) */
  country: string | null;
  countryName: string;
  /** What had to be typed (country, capital or language) */
  answer: string;
  /** Landmark name or the sentence's translation */
  detail: string | null;
  winner: Slot | null;
  wrong: [number, number];
  points: [number, number];
  /** Lock-in games: each player's answer */
  locks: [LockView | null, LockView | null] | null;
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
  /** Games of this match, in play order (Higher or Lower stages are played on their own screen) */
  modes: GameId[];
  /** 0-based index into `modes` of the minigame being played or about to start */
  stage: number;
  /** 1-based round within the current minigame (0 during its countdown) */
  stageRound: number;
  stageRounds: number;
  /** Text shown with the prompt (capitals/GeoLocate: the country; languages: the sentence), else null */
  prompt: string | null;
  /** Flag or landmark photo */
  flagUrl: string | null;
  /** Landmark rounds: where the photo's zoom starts */
  focus: [number, number] | null;
  /** Lock-in games: your own locked-in answer this round */
  myLock: string | null;
  /** Local-clock ms timestamps */
  countdownEndsAt: number | null;
  deadline: number | null;
  regions: RegionId[];
  reveal: RoundSummary | null;
  /** Increments on every wrong guess by the opponent (drives the ✗ flash). */
  oppWrongSeq: number;
  history: RoundSummary[];
  result: MatchResult | null;
  forfeitReason: ForfeitReason | null;
  /** Ranked match info (absent for friend lobbies and the bot demo) */
  ranked?: RankedView | null;
  /** Higher or Lower rounds of a mixed match (absent without them) */
  higher?: DuelView | null;
}

export interface GameActions {
  guess(text: string): Promise<GuessOutcome> | GuessOutcome;
  pass(): void;
  giveUp(): void;
  rematch(): void;
  leave(): void;
}
