import { useEffect, useRef, useState } from 'preact/hooks';
import {
  GUESS_MAX_POINTS,
  MODE_IDS,
  MODES,
  SOLO_BASE_POINTS,
  SOLO_SPEED_POINTS,
  SOLO_WRONG_PENALTY,
  type DailyGuessResponse,
  type DailyResponse,
  type DailySummary,
  type DailyView,
  type GuessOutcome,
  type ModeId,
  type PlacementResult,
  type SoloRoundView,
  focusOf,
  revealMsOf,
  roundTimeOf,
  topPercent,
} from '@flagduel/shared';
import { EstimateLine, NumberInput, QuestionCard, UnitSystemSwitch, questionOf } from './Guess';
import { api, dailyFlagSrc } from '../api';
import { Emblem, RankUp } from './Emblem';
import { DivisionBadge } from './Ranked';
import { CountryInput } from './CountryInput';
import { FlagImage } from './GameScreen';
import { LocateBoard } from './LocateBoard';
import { PhotoCredit, RevealMap, SentenceCard, ZoomPhoto } from './RoundPrompt';
import { Leaderboard } from './Leaderboard';
import { HigherBoard, HigherCard, HigherRules } from './Higher';
import type { GameId } from './NavBar';
import { Logo, formatClock, formatDuration, useNow } from './common';

function formatHms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

/** "Next daily in 5h 12m 03s" */
export function NextDaily({ at }: { at: number }) {
  const now = useNow(true, 1000);
  return <span class="next-daily">Next daily in {formatHms(at - now)}</span>;
}

// ---------- Hub ----------

function ModeCard({
  mode,
  info,
  onPlay,
}: {
  mode: ModeId;
  info: DailySummary['modes'][ModeId] | undefined;
  onPlay: () => void;
}) {
  const m = MODES[mode];
  const status = info?.status ?? 'new';
  return (
    <article class={`daily-mode ${status}`}>
      <div class="dm-text">
        <h3>Daily {m.label}</h3>
        <p class="muted small">
          {m.description} 10 rounds, {roundTimeOf(mode) / 1000} s each.
        </p>
      </div>
      {status === 'finished' ? (
        <div class="dm-done">
          <span class="dm-score">{info!.score}</span>
          <span class="muted small">
            {info!.rank ? `rank #${info!.rank}` : 'points'}
            {info!.timeMs !== null && ` · ${formatDuration(info!.timeMs)}`}
          </span>
          {topPercent(info!.rank, info!.players) !== null && (
            <span class="top-pct">Top {topPercent(info!.rank, info!.players)} %</span>
          )}
          <button class="link" onClick={onPlay}>
            Results
          </button>
        </div>
      ) : (
        <button class="btn btn-primary" onClick={onPlay} disabled={!info}>
          {status === 'playing' ? 'Continue' : 'Play'}
        </button>
      )}
    </article>
  );
}

export function DailyHub({ onPlay }: { onPlay: (game: GameId) => void }) {
  const [s, setSummary] = useState<DailySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dailySummary()
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main class="stack">
      <section class="card">
        <div class="board-head">
          <h2 class="page-title">Daily Games</h2>
          {s && <NextDaily at={s.nextAt} />}
        </div>
        <p class="muted small rules">
          Each game can be played <strong>once per day</strong> — everyone gets the same 10 countries. A correct answer
          is worth {SOLO_BASE_POINTS} points plus up to {SOLO_SPEED_POINTS} for speed, minus {SOLO_WRONG_PENALTY} per
          wrong guess. In GeoLocate every wrong click costs {SOLO_WRONG_PENALTY} points, even if you never find the
          country. Landmarks and Languages take one answer per round: lock it in — a wrong one scores nothing.
          GeoGuesser asks for a number (30 s per question): up to {GUESS_MAX_POINTS} points the closer your estimate
          is, whatever units you answer in. Your score and total time go on today's ranking — on equal points the
          faster run ranks higher, and your results show which top percentage of today's players you are in.
        </p>
        {error && <p class="form-error">{error}</p>}
        <div class="daily-modes">
          {MODE_IDS.map((mode) => (
            <ModeCard key={mode} mode={mode} info={s?.modes[mode]} onPlay={() => onPlay(mode)} />
          ))}
          <HigherCard info={s?.higher} onPlay={() => onPlay('higher')} />
        </div>
        <HigherRules />
      </section>
      <Leaderboard />
      <HigherBoard limit={10} />
    </main>
  );
}

// ---------- Playing ----------

/** Where a solo run lives: the server (daily, ranked placement) or the browser (practice, never stored). */
export interface SoloSource {
  kind: 'daily' | 'practice' | 'placement';
  start(): Promise<DailyResponse>;
  get(): Promise<DailyResponse>;
  guess(round: number, text: string): Promise<DailyGuessResponse>;
  pass(round: number): Promise<DailyResponse>;
  next(round: number): Promise<DailyResponse>;
  flagSrc(flag: string): string;
}

export function dailySource(mode: ModeId): SoloSource {
  return {
    kind: 'daily',
    start: () => api.dailyStart(mode),
    get: () => api.dailyGet(mode),
    guess: (round, text) => api.dailyGuess(mode, round, text),
    pass: (round) => api.dailyPass(mode, round),
    next: (round) => api.dailyNext(mode, round),
    flagSrc: dailyFlagSrc,
  };
}

/** The one-time ranked placement test of `mode`. */
export function placementSource(mode: ModeId): SoloSource {
  return {
    kind: 'placement',
    start: () => api.placementStart(mode),
    get: () => api.placementGet(mode),
    guess: (round, text) => api.placementGuess(mode, round, text),
    pass: (round) => api.placementPass(mode, round),
    next: (round) => api.placementNext(mode, round),
    flagSrc: dailyFlagSrc,
  };
}

export function SoloGame({
  mode,
  source,
  onExit,
  onReplay,
  onImmersive,
}: {
  mode: ModeId;
  source: SoloSource;
  onExit: () => void;
  /** Practice: offer "Play again" on the results */
  onReplay?: () => void;
  /** True while a round is in progress (the app hides the menu bar) */
  onImmersive: (on: boolean) => void;
}) {
  const [run, setRunState] = useState<DailyView | null>(null);
  const runRef = useRef<DailyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  /** Rounds that ended while we watched (auto-advance); a resumed reveal waits for a click. */
  const [liveReveal, setLiveReveal] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [placement, setPlacement] = useState<PlacementResult | null>(null);
  const busy = useRef(false);

  const local = (serverMs: number) => serverMs - offset.current;

  function apply(r: DailyResponse, live: boolean) {
    offset.current = r.now - Date.now();
    const prev = runRef.current;
    // A late guess can return the reveal we already show: keep its auto-advance as is.
    const same = prev?.round === r.run.round && prev?.phase === r.run.phase;
    if ((r.run.phase === 'reveal' || r.run.phase === 'finished') && !same) {
      // Did the round end in front of us? Then auto-advance; otherwise (resumed) wait for a click.
      const watched = live && (prev?.phase === 'playing' || prev?.phase === 'countdown');
      setLiveReveal(watched);
      if (r.run.phase === 'finished' && !watched) setShowResults(true);
    }
    runRef.current = r.run;
    setRunState(r.run);
    if (r.placement) setPlacement(r.placement);
  }

  async function call(p: Promise<DailyResponse>, live = true) {
    try {
      const r = await p;
      apply(r, live);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return null;
    }
  }

  useEffect(() => {
    call(source.start(), false);
  }, [source]);

  const phase = run?.phase;
  const inPlay =
    phase === 'countdown' ||
    phase === 'playing' ||
    (phase === 'reveal' && liveReveal) ||
    (phase === 'finished' && !showResults);
  useEffect(() => {
    onImmersive(!!inPlay);
    return () => onImmersive(false);
  }, [inPlay]);

  // Server-driven transitions: countdown → playing, deadline → reveal, reveal → next round.
  useEffect(() => {
    if (!run) return;
    let at: number | null = null;
    let action: (() => void) | null = null;
    if (run.phase === 'countdown') {
      at = local(run.startsAt) + 30;
      action = () => call(source.get());
    } else if (run.phase === 'playing' && run.deadline) {
      at = local(run.deadline) + 120;
      action = () => call(source.get());
    } else if (run.phase === 'reveal' && liveReveal) {
      at = Date.now() + revealMsOf(run.mode);
      action = next;
    } else if (run.phase === 'finished' && !showResults) {
      at = Date.now() + revealMsOf(run.mode);
      action = () => setShowResults(true);
    }
    if (at === null || !action) return;
    const id = setTimeout(action, Math.max(0, at - Date.now()));
    return () => clearTimeout(id);
  }, [run, liveReveal, showResults]);

  async function next() {
    if (!run || busy.current) return;
    busy.current = true;
    await call(source.next(run.round));
    busy.current = false;
  }

  async function guess(text: string): Promise<GuessOutcome> {
    if (!run || run.phase !== 'playing') return 'ignored';
    try {
      const r = await source.guess(run.round, text);
      apply(r, true);
      return r.outcome;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return 'ignored';
    }
  }

  if (error && !run) {
    return (
      <main class="stack">
        <section class="card center-card">
          <p class="form-error">{error}</p>
          <button class="btn btn-ghost" onClick={onExit}>
            Back
          </button>
        </section>
      </main>
    );
  }
  if (!run) {
    return (
      <main class="stack">
        <section class="card center-card">
          <p class="muted">
            {source.kind === 'practice'
              ? 'Loading…'
              : source.kind === 'placement'
                ? 'Loading your placement test…'
                : `Loading today's ${MODES[mode].label.toLowerCase()}…`}
          </p>
        </section>
      </main>
    );
  }
  if (run.phase === 'finished' && showResults && source.kind === 'placement')
    return <PlacementResults run={run} result={placement} source={source} onExit={onExit} />;
  if (run.phase === 'finished' && showResults)
    return <SoloResults run={run} source={source} onExit={onExit} onReplay={onReplay} />;
  return (
    <SoloScreen
      run={run}
      source={source}
      local={local}
      onGuess={guess}
      onPass={() => call(source.pass(run.round))}
      onQuit={source.kind === 'practice' ? onExit : undefined}
      onNext={next}
      manualNext={run.phase === 'reveal' && !liveReveal}
      error={error}
    />
  );
}

function SoloScreen({
  run,
  source,
  local,
  onGuess,
  onPass,
  onQuit,
  onNext,
  manualNext,
  error,
}: {
  run: DailyView;
  source: SoloSource;
  local: (serverMs: number) => number;
  onGuess: (text: string) => Promise<GuessOutcome>;
  onPass: () => void;
  /** Practice only: leave mid-run (a daily run keeps going on the server) */
  onQuit?: () => void;
  onNext: () => void;
  manualNext: boolean;
  error: string | null;
}) {
  const mode = MODES[run.mode];
  const now = useNow(run.phase === 'playing' || run.phase === 'countdown', 100);
  const deadline = run.deadline !== null ? local(run.deadline) : null;
  const left = run.phase === 'playing' && deadline !== null ? deadline - now : null;
  const done = run.history.length;
  const locked = run.phase !== 'playing';
  const r = run.reveal;
  const isMap = mode.input === 'map';
  const count = Math.max(1, Math.ceil((local(run.startsAt) - now) / 1000));
  const placement = source.kind === 'placement';
  // Map modes: show the miss penalty right away (it is settled when the round ends).
  // The placement test only counts correct answers.
  const liveScore = placement
    ? run.history.filter((h) => h.end === 'correct').length
    : run.score - (isMap && run.phase === 'playing' ? run.wrong * SOLO_WRONG_PENALTY : 0);
  const missed = (end: string, wrong: number) =>
    end === 'timeout'
      ? "Time's up"
      : end === 'wrong'
        ? 'Wrong'
        : mode.maxWrong !== undefined && wrong >= mode.maxWrong
          ? 'Out of tries'
          : 'Skipped';

  const estimate = mode.input === 'number';
  const statusLine = r && estimate ? (
    <div class={`status-line reveal ${r.points >= 50 ? 'win' : r.points > 0 ? 'none' : 'lose'}`}>
      <ul class="lock-lines estimates">
        <EstimateLine who="You" code={r.code} raw={r.given} points={r.points} pointsLabel={`${r.points} points`} />
      </ul>
      {r.end === 'timeout' && <span class="reveal-who">Time's up — no points</span>}
      {r.end === 'passed' && <span class="reveal-who">Skipped — no points</span>}
    </div>
  ) : r ? (
    <div class={`status-line reveal ${r.end === 'correct' ? 'win' : r.end === 'wrong' ? 'lose' : 'none'}`}>
      <strong class="reveal-country">{r.answer}</strong>
      {run.mode === 'capitals' && <span class="reveal-of">capital of {r.countryName}</span>}
      {run.mode === 'landmarks' && r.detail && <span class="reveal-of">{r.detail}</span>}
      {r.given && r.end === 'wrong' && <span class="reveal-of">You said {r.given}</span>}
      <span class="reveal-who">
        {placement
          ? r.end === 'correct'
            ? 'Correct'
            : missed(r.end, r.wrong)
          : r.end === 'correct'
            ? `+${r.points} points${r.timeMs !== null ? ` · ${(r.timeMs / 1000).toFixed(1)} s` : ''}`
            : `${missed(r.end, r.wrong)} — ${r.points < 0 ? `−${-r.points} points` : 'no points'}`}
      </span>
    </div>
  ) : run.phase === 'countdown' ? (
    <div class="status-line muted">Get ready…</div>
  ) : (
    <div class="status-line muted hint">
      {placement
        ? run.wrong > 0
          ? `${run.wrong} wrong`
          : 'Speed doesn’t count, only correct answers'
        : estimate
          ? 'One estimate — the closer, the more points. Take your time'
          : mode.lockIn
          ? 'One answer — lock it in. The sooner, the more points'
          : run.wrong > 0
            ? `${run.wrong} wrong (−${run.wrong * SOLO_WRONG_PENALTY})`
            : 'Faster answers score more'}
    </div>
  );

  return (
    <main class={`stack${isMap ? ' wide' : ''}`}>
      <section class="card top-card">
        <header class="brand">
          <Logo />
          <h1>
            {source.kind === 'practice' ? (
              <>
                Practice <em>· {mode.label}</em>
              </>
            ) : placement ? (
              <>
                Placement test <em>· {mode.label}</em>
              </>
            ) : (
              <>
                Daily {mode.label} <em>· {run.date}</em>
              </>
            )}
          </h1>
        </header>
        <div class="status-row">
          <span class="round-label">
            Round {run.round}/{run.totalRounds}
          </span>
          <div class="scoreboard solo" aria-label={`Score ${liveScore}`}>
            <span class="sb-score">{liveScore}</span>
            <span class="sb-name">{placement ? 'correct' : 'points'}</span>
          </div>
          <span class={`timer${left !== null && left <= 5000 ? ' urgent' : ''}`}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M8 9V6M6 1.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
            {left !== null ? formatClock(left) : '–:––'}
          </span>
        </div>
        {placement ? (
          <StreakStrip history={run.history} total={run.totalRounds} current={run.phase === 'reveal' ? null : done} />
        ) : (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={run.totalRounds} aria-valuenow={done}>
            <div class="progress-fill" style={{ width: `${(done / run.totalRounds) * 100}%` }} />
          </div>
        )}
      </section>

      {isMap ? (
        <section class="card game-card map-card">
          <LocateBoard
            prompt={run.prompt ?? r?.countryName ?? null}
            flagUrl={run.flag ? source.flagSrc(run.flag) : r ? source.flagSrc(r.flag) : null}
            roundKey={run.round}
            locked={locked}
            answerCode={r?.code ?? null}
            serverWrong={run.wrong}
            onGuess={onGuess}
            onPass={onPass}
            overlay={
              run.phase === 'countdown' ? (
                <div class="countdown" key={count}>
                  {count}
                </div>
              ) : null
            }
            status={statusLine}
            hud={
              <>
                <span>
                  {run.round}/{run.totalRounds}
                </span>
                <span>{liveScore}</span>
                <span class={left !== null && left <= 5000 ? 'urgent' : ''}>
                  {left !== null ? formatClock(left) : '–:––'}
                </span>
              </>
            }
          />
          {manualNext && (
            <div class="btn-row">
              <button class="btn btn-primary" onClick={onNext}>
                Next round
              </button>
            </div>
          )}
          {error && <p class="form-error">{error}</p>}
          <SoloNote onQuit={onQuit} />
        </section>
      ) : (
        <section class="card game-card">
          <div class="round-badge">{run.round}</div>
          <div class={`flag-frame ${mode.prompt}-prompt`}>
            {run.phase === 'countdown' ? (
              <div class="countdown" key={Math.ceil((local(run.startsAt) - now) / 1000)}>
                {Math.max(1, Math.ceil((local(run.startsAt) - now) / 1000))}
              </div>
            ) : mode.prompt === 'photo' ? (
              (run.flag ?? r?.flag) && (
                <ZoomPhoto
                  key={run.flag ?? r!.flag}
                  src={source.flagSrc((run.flag ?? r!.flag)!)}
                  focus={run.focus ?? focusOf(r!.code)}
                  startedAt={deadline !== null && run.phase === 'playing' ? deadline - roundTimeOf(run.mode) : null}
                  full={run.phase !== 'playing'}
                />
              )
            ) : mode.prompt === 'question' ? (
              <QuestionCard prompt={run.prompt} code={r?.code ?? null} />
            ) : mode.prompt === 'sentence' ? (
              (run.prompt ?? r) && (
                <SentenceCard text={run.prompt ?? mode.promptText!(r!.code)} translation={r?.detail} />
              )
            ) : run.flag ? (
              <FlagImage src={source.flagSrc(run.flag)} key={run.flag} />
            ) : r ? (
              <FlagImage src={source.flagSrc(r.flag)} key={r.flag} />
            ) : null}
          </div>
          {run.prompt && run.phase === 'playing' && mode.prompt === 'flag' && (
            <p class="prompt">
              Capital of <strong>{run.prompt}</strong>?
            </p>
          )}
          {statusLine}
          {r && run.mode === 'landmarks' && r.country && (
            <>
              <RevealMap country={r.country} landmark={r.code} />
              <PhotoCredit id={r.code} />
            </>
          )}
          {manualNext ? (
            <div class="btn-row">
              <button class="btn btn-primary" onClick={onNext}>
                Next round
              </button>
            </div>
          ) : estimate ? (
            <NumberInput
              quantity={questionOf(run.prompt, r?.code ?? null)?.quantity ?? null}
              locked={locked}
              focusKey={run.round}
              onSubmit={onGuess}
            />
          ) : (
            <div class="guess-row">
              <CountryInput
                locked={locked}
                focusKey={run.round}
                onSubmit={onGuess}
                suggest={mode.suggest}
                placeholder={mode.placeholder}
                submitLabel={mode.lockIn ? 'Lock in' : undefined}
              />
            </div>
          )}
          {!manualNext && (
            <div class="give-up">
              <button class="btn btn-sm btn-pass" type="button" disabled={locked} onClick={onPass}>
                Pass
              </button>
            </div>
          )}
          {error && <p class="form-error">{error}</p>}
          <SoloNote onQuit={onQuit} />
        </section>
      )}
    </main>
  );
}

/** Correct answers in a row at the end of `history`. */
function currentStreak(history: readonly SoloRoundView[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].end === 'correct'; i--) n++;
  return n;
}

function bestStreak(history: readonly SoloRoundView[]): number {
  let best = 0;
  let n = 0;
  for (const h of history) {
    n = h.end === 'correct' ? n + 1 : 0;
    best = Math.max(best, n);
  }
  return best;
}

/** Answers so far as green ✓ / red ✗ boxes, the current round outlined and the rest still empty. */
function StreakStrip({
  history,
  total,
  current,
  animate = true,
}: {
  history: readonly SoloRoundView[];
  total: number;
  /** Index of the round being played (null while revealing / finished) */
  current: number | null;
  /** Pop in the newest answer (off on the results) */
  animate?: boolean;
}) {
  const streak = currentStreak(history);
  const last = history.length - 1;
  return (
    <div class="streak" aria-label={`${history.filter((h) => h.end === 'correct').length} of ${history.length} correct`}>
      <ol class="streak-tiles">
        {Array.from({ length: total }, (_, i) => {
          const h = history[i];
          const state = h ? (h.end === 'correct' ? 'ok' : 'miss') : i === current ? 'now' : 'todo';
          return (
            <li
              key={i}
              class={`st ${state}${animate && i === last && current === null ? ' fresh' : ''}`}
              title={h ? `${i + 1}. ${h.answer}` : undefined}
            >
              {state === 'ok' ? '✓' : state === 'miss' ? '✗' : ''}
            </li>
          );
        })}
      </ol>
      {animate && streak >= 2 && (
        <p class="streak-fire" key={streak}>
          🔥 {streak} in a row
        </p>
      )}
    </div>
  );
}

function SoloNote({ onQuit }: { onQuit?: () => void }) {
  return onQuit ? (
    <p class="muted small center solo-note">
      Practice isn't scored or saved.{' '}
      <button class="link" onClick={onQuit}>
        Quit
      </button>
    </p>
  ) : (
    <p class="muted small center solo-note">The timer keeps running if you leave the page.</p>
  );
}

function PlacementResults({
  run,
  result,
  source,
  onExit,
}: {
  run: DailyView;
  result: PlacementResult | null;
  source: SoloSource;
  onExit: () => void;
}) {
  const mode = MODES[run.mode];
  const [celebrate, setCelebrate] = useState(true);
  const correct = result?.correct ?? run.history.filter((h) => h.end === 'correct').length;
  return (
    <main class="stack">
      <section class="card results-banner win">
        <Logo size={52} />
        <h1>Placement done!</h1>
        <p class="banner-sub">
          {correct} of {run.totalRounds} correct · {Math.round((correct / run.totalRounds) * 100)}%
        </p>
        {result && (
          <div class="placement-result">
            <Emblem division={result.division} size={72} label />
            <DivisionBadge division={result.division} icon={false} />
            <span class="rating-num">{result.rating}</span>
            <span class="muted small">your starting {mode.label} rating</span>
          </div>
        )}
        <StreakStrip history={run.history} total={run.totalRounds} current={null} animate={false} />
        {bestStreak(run.history) >= 2 && <p class="muted small">Best streak: {bestStreak(run.history)} in a row</p>}
        {result && celebrate && (
          <RankUp
            division={result.division}
            kicker="You placed in"
            detail={`Starting ${mode.label} rating ${result.rating}`}
            onClose={() => setCelebrate(false)}
          />
        )}
        <div class="btn-row">
          <button class="btn btn-primary" onClick={onExit}>
            Play ranked
          </button>
        </div>
      </section>

      <section class="card rounds-card">
        <h2>Your answers</h2>
        <table class="rounds">
          <thead>
            <tr>
              <th>#</th>
              <th>Flag</th>
              <th class="left">{run.mode === 'capitals' ? 'Capital' : 'Country'}</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.history.map((h, i) => (
              <tr key={i}>
                <td class="num">{i + 1}</td>
                <td>
                  <img class="thumb" src={source.flagSrc(h.flag)} alt="" />
                </td>
                <td class="left country">
                  {h.answer}
                  {run.mode === 'capitals' && <span class="of-country">{h.countryName}</span>}
                </td>
                <td>
                  <span class={`pill ${h.end === 'correct' ? 'me' : 'none'}`}>
                    {h.end === 'correct' ? '✓' : h.end === 'timeout' ? 'timeout' : 'missed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function SoloResults({
  run,
  source,
  onExit,
  onReplay,
}: {
  run: DailyView;
  source: SoloSource;
  onExit: () => void;
  onReplay?: () => void;
}) {
  const correct = run.history.filter((h) => h.end === 'correct').length;
  const mode = MODES[run.mode];
  const practice = source.kind === 'practice';
  return (
    <main class="stack">
      <section class="card results-banner win">
        <Logo size={52} />
        <h1>{practice ? `Practice ${mode.label} done!` : `Daily ${mode.label} done!`}</h1>
        <p class="banner-sub">
          {correct} of {run.totalRounds} {mode.input === 'number' ? 'good estimates' : 'correct'}
          {practice ? ' · not saved' : ` · ${run.date}`}
        </p>
        <div class="final-score solo">
          <div class="fs-player">
            <span class="fs-points">{run.score}</span>
            <span class="fs-name">of {run.maxScore} points</span>
          </div>
          <div class="fs-player">
            <span class="fs-points">{formatDuration(run.timeMs)}</span>
            <span class="fs-name">total time</span>
          </div>
        </div>
        {!practice && <TopPercentBanner mode={run.mode} refreshKey={run.score} />}
        <div class="btn-row">
          {onReplay && (
            <button class="btn btn-primary" onClick={onReplay}>
              Play again
            </button>
          )}
          <button class={`btn ${onReplay ? 'btn-ghost' : 'btn-primary'}`} onClick={onExit}>
            {practice ? 'Change settings' : 'Back to Daily Games'}
          </button>
        </div>
      </section>

      {!practice && <Leaderboard initial={run.mode} refreshKey={run.score} />}

      {mode.input === 'number' ? (
        <EstimateRounds run={run} />
      ) : (
      <section class="card rounds-card">
        <h2>Your rounds</h2>
        <table class="rounds">
          <thead>
            <tr>
              <th>#</th>
              {mode.prompt !== 'sentence' && <th>{mode.prompt === 'photo' ? 'Photo' : 'Flag'}</th>}
              <th class="left">{run.mode === 'capitals' ? 'Capital' : run.mode === 'languages' ? 'Language' : 'Country'}</th>
              <th>Time</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {run.history.map((h, i) => (
              <tr key={i}>
                <td class="num">{i + 1}</td>
                {mode.prompt !== 'sentence' && (
                  <td>
                    <img class={`thumb${mode.prompt === 'photo' ? ' photo-thumb' : ''}`} src={source.flagSrc(h.flag)} alt="" />
                  </td>
                )}
                <td class="left country">
                  {h.answer}
                  {run.mode === 'capitals' && <span class="of-country">{h.countryName}</span>}
                  {run.mode === 'landmarks' && <span class="of-country">{h.detail}</span>}
                  {h.end === 'wrong' && h.given && <span class="of-country">you said {h.given}</span>}
                </td>
                <td class="num">
                  {h.timeMs !== null
                    ? `${(h.timeMs / 1000).toFixed(1)} s`
                    : h.end === 'timeout'
                      ? 'timeout'
                      : h.end === 'wrong'
                        ? 'wrong'
                        : 'passed'}
                </td>
                <td>
                  <span class={`pill ${h.points > 0 ? 'me' : h.points < 0 ? 'minus' : 'none'}`}>
                    {h.points > 0 ? `+${h.points}` : h.points < 0 ? `−${-h.points}` : '0'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
    </main>
  );
}

/** "Top 12 %": where the finished daily run stands among today's players. */
function TopPercentBanner({ mode, refreshKey }: { mode: ModeId; refreshKey: unknown }) {
  const [data, setData] = useState<{ rank: number; players: number } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .leaderboard(mode)
      .then((d) => alive && d.you && setData({ rank: d.you.rank, players: d.players }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, refreshKey]);
  if (!data) return null;
  const pct = topPercent(data.rank, data.players);
  return (
    <div class="top-banner">
      {pct === null ? (
        <>
          <strong>First to finish today!</strong>
          <span class="muted small">Check back later to see how you compare.</span>
        </>
      ) : (
        <>
          <span class="muted small">You are in the</span>
          <strong>Top {pct} %</strong>
          <span class="muted small">
            of today's players · rank {data.rank} of {data.players}
          </span>
        </>
      )}
    </div>
  );
}

/** GeoGuesser rounds: the question, the answer, your estimate and its points. */
function EstimateRounds({ run }: { run: DailyView }) {
  return (
    <section class="card rounds-card">
      <div class="board-head">
        <h2>Your estimates</h2>
        <UnitSystemSwitch />
      </div>
      <ol class="estimate-rounds">
        {run.history.map((h, i) => (
          <li key={i}>
            <span class="er-num">{i + 1}</span>
            <div class="er-body">
              <QuestionCard prompt={null} code={h.code} />
              <ul class="lock-lines estimates">
                <EstimateLine who="You" code={h.code} raw={h.given} points={h.points} />
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
