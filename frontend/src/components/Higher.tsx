import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  HIGHER_REVEAL_MS,
  HIGHER_TIME_MS,
  STATS,
  type HigherBoardResponse,
  type HigherEnd,
  type HigherResponse,
  type HigherRunView,
  type HigherSummary,
  type PairView,
  type StatId,
} from '@flagduel/shared';
import { api, codeFlagSrc } from '../api';
import { Logo, formatDuration, useNow } from './common';

export const HIGHER_LABEL = 'Higher or Lower';
export const HIGHER_DESC = 'Two countries, one statistic: pick the one with the higher value.';
/** Multiplayer names: the flag games (fastest correct answer wins) and the Higher or Lower duel */
export const GEO_SPEED_LABEL = 'Geo Speed';
export const GEO_KNOWLEDGE_LABEL = 'Geo Knowledge';

// ---------- Building blocks (daily and 1 vs 1) ----------

/** Category icon + name, and the question. */
export function StatHeader({ stat, kicker }: { stat: StatId; kicker?: ComponentChildren }) {
  const s = STATS[stat];
  return (
    <div class="hl-head">
      {kicker && <span class="hl-kicker">{kicker}</span>}
      <span class="hl-stat">
        <span class="hl-icon" aria-hidden="true">
          {s.icon}
        </span>
        {s.label}
      </span>
      <p class="hl-question">{s.question}</p>
    </div>
  );
}

/** A value counting up from 0 once it is revealed. */
function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      el.textContent = format(p < 1 ? value * (1 - (1 - p) ** 3) : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}

export interface Revealed {
  values: [number, number];
  /** The country with the higher value */
  answer: string;
}

/** A small name tag on a tile: who picked it. */
export interface PickTag {
  code: string;
  label: string;
  kind: 'me' | 'opp';
}

/**
 * The two countries, each a big button. Values stay hidden ("?") until `revealed`; then they count up,
 * the higher country is marked, and wrong picks turn red.
 */
export function PairBoard({
  pair,
  revealed,
  known = null,
  mine,
  tags = [],
  locked,
  onPick,
}: {
  pair: PairView;
  revealed: Revealed | null;
  /** Value of country b already shown in the previous question (daily chain) */
  known?: number | null;
  /** Your pick (outlined while waiting for the result) */
  mine: string | null;
  /** Who picked what, shown after the reveal */
  tags?: PickTag[];
  locked: boolean;
  onPick: (code: string) => void;
}) {
  const fmt = STATS[pair.stat].format;
  const tile = (code: string, name: string, i: 0 | 1) => {
    const isAnswer = revealed?.answer === code;
    const state = revealed ? (isAnswer ? 'higher' : 'lower') : mine === code ? 'picked' : mine ? 'other' : '';
    const wrong = revealed && mine === code && !isAnswer;
    return (
      <button
        type="button"
        class={`hl-tile ${state}${wrong ? ' wrong' : ''}${mine === code ? ' mine' : ''}`}
        disabled={locked || mine !== null}
        aria-pressed={mine === code}
        aria-label={`${name}${revealed ? `: ${fmt(revealed.values[i])}` : ''}`}
        onClick={() => onPick(code)}
      >
        <img class="hl-flag" src={codeFlagSrc(code)} alt="" draggable={false} />
        <span class="hl-name">{name}</span>
        <span class={`hl-value${revealed ? ' shown' : i === 1 && known !== null ? ' known' : ''}`}>
          {revealed ? (
            <CountUp key="shown" value={revealed.values[i]} format={fmt} />
          ) : i === 1 && known !== null ? (
            fmt(known)
          ) : (
            '?'
          )}
        </span>
        {revealed && isAnswer && <span class="hl-badge">▲ Higher</span>}
        {tags.some((t) => t.code === code) && (
          <span class="hl-tags">
            {tags
              .filter((t) => t.code === code)
              .map((t) => (
                <span key={t.label} class={`hl-tag ${t.kind}${isAnswer ? ' ok' : ' bad'}`}>
                  {isAnswer ? '✓' : '✗'} {t.label}
                </span>
              ))}
          </span>
        )}
      </button>
    );
  };
  return (
    <div class="hl-board">
      {tile(pair.a, pair.aName, 0)}
      <span class="hl-vs" aria-hidden="true">
        VS
      </span>
      {tile(pair.b, pair.bName, 1)}
    </div>
  );
}

/** A 10-second bar that drains; red for the last 3 seconds. */
export function TimeBar({ deadline, total = HIGHER_TIME_MS }: { deadline: number | null; total?: number }) {
  const now = useNow(deadline !== null, 100);
  const left = deadline !== null ? Math.max(0, deadline - now) : null;
  return (
    <div class={`hl-time${left !== null && left <= 3000 ? ' urgent' : ''}`} aria-hidden="true">
      <div class="hl-time-fill" style={{ width: `${left === null ? 0 : (left / total) * 100}%` }} />
      <span class="hl-time-num">{left === null ? '' : Math.ceil(left / 1000)}</span>
    </div>
  );
}

/**
 * One tile per question. The flawless start is bright green; the first mistake gets a ring; everything
 * after it is faded, because from there on answers only break ties.
 */
export function FlawlessStrip({
  ends,
  total,
  current,
  animate = true,
}: {
  ends: readonly HigherEnd[];
  total: number;
  /** 0-based index of the question being played, null while revealing / finished */
  current: number | null;
  animate?: boolean;
}) {
  const first = ends.findIndex((e) => e !== 'correct');
  const flawless = first < 0 ? ends.length : first;
  const broken = first >= 0;
  return (
    <div class="streak hl-streak" aria-label={`${flawless} flawless`}>
      <ol class="streak-tiles">
        {Array.from({ length: total }, (_, i) => {
          const e = ends[i];
          const after = broken && i > first;
          const state = e ? (e === 'correct' ? 'ok' : 'miss') : i === current ? 'now' : 'todo';
          return (
            <li
              key={i}
              class={`st ${state}${after ? ' after' : ''}${i === first ? ' first' : ''}${animate && i === ends.length - 1 && current === null ? ' fresh' : ''}`}
              title={`Question ${i + 1}`}
            >
              {state === 'ok' ? '✓' : state === 'miss' ? '✗' : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Daily ----------

/** The Daily Higher or Lower card on the Daily Games page. */
export function HigherCard({ info, onPlay }: { info: HigherSummary | undefined; onPlay: () => void }) {
  const status = info?.status ?? 'new';
  const stat = info ? STATS[info.stat] : null;
  return (
    <article class={`daily-mode ${status}`}>
      <div class="dm-text">
        <h3>Daily {HIGHER_LABEL}</h3>
        <p class="muted small">
          {stat ? (
            <>
              Today: {stat.icon} <strong>{stat.label}</strong> · {info!.rounds} questions, 10 s each.
            </>
          ) : (
            'Loading…'
          )}
        </p>
      </div>
      {status === 'finished' ? (
        <div class="dm-done">
          <span class="dm-score">{info!.flawless}</span>
          <span class="muted small">flawless{info!.rank ? ` · rank #${info!.rank}` : ''}</span>
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

export function HigherRules() {
  return (
    <p class="muted small rules">
      <strong>Daily {HIGHER_LABEL}:</strong> one category for everyone, 15 questions, 10 seconds each. Each question
      brings in a new country against the last one, whose value you already know. You play all 15, but what counts is{' '}
      <strong>how far you get without a mistake</strong>: 9 right before your first slip beats 2 right before it,
      however well the rest goes. Correct answers after that, then your time, only break ties.
    </p>
  );
}

export function HigherGame({ onExit, onImmersive }: { onExit: () => void; onImmersive: (on: boolean) => void }) {
  const [run, setRunState] = useState<HigherRunView | null>(null);
  const runRef = useRef<HigherRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const [liveReveal, setLiveReveal] = useState(false);
  const [showResults, setShowResults] = useState(false);
  /** Picked, waiting for the server */
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  const local = (serverMs: number) => serverMs - offset.current;

  function apply(r: HigherResponse, live: boolean) {
    offset.current = r.now - Date.now();
    const prev = runRef.current;
    const same = prev?.round === r.run.round && prev?.phase === r.run.phase;
    if ((r.run.phase === 'reveal' || r.run.phase === 'finished') && !same) {
      const watched = live && (prev?.phase === 'playing' || prev?.phase === 'countdown');
      setLiveReveal(watched);
      if (r.run.phase === 'finished' && !watched) setShowResults(true);
    }
    if (r.run.phase !== 'playing') setPending(null);
    runRef.current = r.run;
    setRunState(r.run);
  }

  async function call(p: Promise<HigherResponse>, live = true) {
    try {
      apply(await p, live);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    call(api.higherStart(), false);
  }, []);

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

  // Server-driven transitions: countdown → playing, deadline → timeout, reveal → next question.
  useEffect(() => {
    if (!run) return;
    let at: number | null = null;
    let action: (() => void) | null = null;
    if (run.phase === 'countdown') {
      at = local(run.startsAt) + 30;
      action = () => call(api.higherGet());
    } else if (run.phase === 'playing' && run.deadline) {
      at = local(run.deadline) + 120;
      action = () => call(api.higherGet());
    } else if (run.phase === 'reveal' && liveReveal) {
      at = Date.now() + HIGHER_REVEAL_MS;
      action = next;
    } else if (run.phase === 'finished' && !showResults) {
      at = Date.now() + HIGHER_REVEAL_MS;
      action = () => setShowResults(true);
    }
    if (at === null || !action) return;
    const id = setTimeout(action, Math.max(0, at - Date.now()));
    return () => clearTimeout(id);
  }, [run, liveReveal, showResults]);

  async function next() {
    if (!run || busy.current) return;
    busy.current = true;
    await call(api.higherNext(run.round));
    busy.current = false;
  }

  function pick(code: string) {
    if (!run || run.phase !== 'playing' || pending) return;
    setPending(code);
    call(api.higherPick(run.round, code));
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
          <p class="muted">Loading today's {HIGHER_LABEL}…</p>
        </section>
      </main>
    );
  }
  if (run.phase === 'finished' && showResults) return <HigherResults run={run} onExit={onExit} />;
  return (
    <HigherScreen
      run={run}
      local={local}
      pending={pending}
      onPick={pick}
      onNext={next}
      manualNext={run.phase === 'reveal' && !liveReveal}
      error={error}
    />
  );
}

function HigherScreen({
  run,
  local,
  pending,
  onPick,
  onNext,
  manualNext,
  error,
}: {
  run: HigherRunView;
  local: (serverMs: number) => number;
  pending: string | null;
  onPick: (code: string) => void;
  onNext: () => void;
  manualNext: boolean;
  error: string | null;
}) {
  const now = useNow(run.phase === 'countdown', 100);
  const ends = run.history.map((h) => h.end);
  const broken = ends.some((e) => e !== 'correct');
  const r = run.reveal;
  const pair: PairView | null = run.pair ?? r;
  const count = Math.max(1, Math.ceil((local(run.startsAt) - now) / 1000));

  const status = r ? (
    <div class={`status-line reveal ${r.end === 'correct' ? 'win' : 'lose'}`}>
      <strong class="reveal-country">
        {r.end === 'correct' ? 'Correct!' : r.end === 'timeout' ? "Time's up" : 'Wrong'}
      </strong>
      <span class="reveal-who">
        {r.end === 'correct'
          ? broken
            ? `${run.correct} correct so far — breaks ties`
            : `${run.flawless} flawless in a row`
          : run.flawless === run.round - 1
            ? `Your flawless streak ends at ${run.flawless}. Keep going — correct answers still break ties.`
            : `${r.answer === r.a ? r.aName : r.bName} is higher`}
      </span>
    </div>
  ) : run.phase === 'countdown' ? (
    <div class="status-line muted">Get ready…</div>
  ) : (
    <div class="status-line muted hint">
      {broken ? 'Streak over — every correct answer still breaks ties' : 'Pick the country with the higher value'}
    </div>
  );

  return (
    <main class="stack">
      <section class="card top-card">
        <header class="brand">
          <Logo />
          <h1>
            Daily {HIGHER_LABEL} <em>· {run.date}</em>
          </h1>
        </header>
        <div class="status-row">
          <span class="round-label">
            Question {run.round}/{run.totalRounds}
          </span>
          <div class={`scoreboard solo hl-flawless${broken ? ' broken' : ''}`} aria-label={`${run.flawless} flawless`}>
            <span class="sb-score">{run.flawless}</span>
            <span class="sb-name">{broken ? 'flawless · final' : 'flawless'}</span>
          </div>
          <span class="round-label side">{run.correct} correct</span>
        </div>
        <FlawlessStrip ends={ends} total={run.totalRounds} current={run.phase === 'reveal' ? null : run.round - 1} />
        <p class={`hl-streak-note${broken ? ' broken' : ''}`}>
          {broken
            ? `Your score: ${run.flawless} flawless. The rest only breaks ties.`
            : run.flawless >= 2
              ? `🔥 ${run.flawless} in a row — how far can you go without a mistake?`
              : 'Your score is how far you get without a single mistake.'}
        </p>
      </section>

      <section class="card game-card hl-card">
        <StatHeader stat={run.stat} />
        {run.phase === 'countdown' || !pair ? (
          <div class="hl-countdown">
            <div class="countdown" key={count}>
              {count}
            </div>
          </div>
        ) : (
          <PairBoard
            key={run.round}
            pair={pair}
            revealed={r ? { values: r.values, answer: r.answer } : null}
            known={run.known}
            mine={r ? r.pick : pending}
            tags={r?.pick ? [{ code: r.pick, label: 'You', kind: 'me' }] : []}
            locked={run.phase !== 'playing'}
            onPick={onPick}
          />
        )}
        <TimeBar deadline={run.phase === 'playing' && run.deadline ? local(run.deadline) : null} />
        {status}
        {manualNext && (
          <div class="btn-row">
            <button class="btn btn-primary" onClick={onNext}>
              Next question
            </button>
          </div>
        )}
        {error && <p class="form-error">{error}</p>}
        <p class="muted small center solo-note">
          The timer keeps running if you leave the page. Source: {STATS[run.stat].source}.
        </p>
      </section>
    </main>
  );
}

function HigherResults({ run, onExit }: { run: HigherRunView; onExit: () => void }) {
  const perfect = run.flawless === run.totalRounds;
  const stat = STATS[run.stat];
  return (
    <main class="stack">
      <section class="card results-banner win">
        <Logo size={52} />
        <h1>{perfect ? 'Flawless run!' : `${run.flawless} flawless`}</h1>
        <p class="banner-sub">
          {stat.icon} {stat.label} · {run.date}
        </p>
        <div class="final-score solo">
          <div class="fs-player">
            <span class="fs-points">
              {run.flawless}
              <small>/{run.totalRounds}</small>
            </span>
            <span class="fs-name">flawless — your score</span>
          </div>
          <div class="fs-player">
            <span class="fs-points">{run.correct}</span>
            <span class="fs-name">correct in total</span>
          </div>
          <div class="fs-player">
            <span class="fs-points">{formatDuration(run.timeMs)}</span>
            <span class="fs-name">total time</span>
          </div>
        </div>
        <FlawlessStrip ends={run.history.map((h) => h.end)} total={run.totalRounds} current={null} animate={false} />
        <p class="muted small">
          {perfect
            ? 'Not a single mistake. Only time can beat you now.'
            : `You got ${run.flawless} right before your first mistake. That's what the ranking counts first; your ${run.correct} correct answers and your time only break ties.`}
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" onClick={onExit}>
            Back to Daily Games
          </button>
        </div>
      </section>

      <HigherBoard refreshKey={run.flawless} />

      <section class="card rounds-card">
        <h2>Your answers</h2>
        <table class="rounds hl-rounds">
          <thead>
            <tr>
              <th>#</th>
              <th class="left">Higher</th>
              <th class="left">Lower</th>
              <th>You</th>
            </tr>
          </thead>
          <tbody>
            {run.history.map((h, i) => {
              const hi = h.answer === h.a ? 0 : 1;
              const names = [h.aName, h.bName];
              const codes = [h.a, h.b];
              return (
                <tr key={i} class={i === run.flawless && h.end !== 'correct' ? 'first-miss' : ''}>
                  <td class="num">{i + 1}</td>
                  {[hi, 1 - hi].map((k) => (
                    <td class="left" key={k}>
                      <span class="hl-cell">
                        <img class="thumb" src={codeFlagSrc(codes[k])} alt="" />
                        <span>
                          {names[k]}
                          <span class="of-country">{stat.format(h.values[k])}</span>
                        </span>
                      </span>
                    </td>
                  ))}
                  <td>
                    <span class={`pill ${h.end === 'correct' ? 'me' : 'minus'}`}>
                      {h.end === 'correct' ? '✓' : h.end === 'timeout' ? 'time' : '✗'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

/** Today's Higher or Lower ranking: flawless first, then correct, then time. */
export function HigherBoard({ limit, refreshKey }: { limit?: number; refreshKey?: unknown }) {
  const [data, setData] = useState<HigherBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .higherBoard()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const rows = data ? data.entries.slice(0, limit ?? data.entries.length) : null;
  const youOutside = data?.you && rows && !rows.some((r) => r.you) ? data.you : null;
  const row = (e: HigherBoardResponse['entries'][number], k: number | string) => (
    <tr key={k} class={e.you ? 'you' : ''}>
      <td class={`rank r${e.rank}`}>{e.rank}</td>
      <td class="name">
        {e.name}
        {e.you && <span class="you-tag">you</span>}
      </td>
      <td class="score">{e.flawless}</td>
      <td class="time">{e.correct}</td>
      <td class="time">{formatDuration(e.timeMs)}</td>
    </tr>
  );

  return (
    <section class="card board-card">
      <div class="board-head">
        <h2>
          {HIGHER_LABEL} ranking
          {data && (
            <span class="muted small">
              {' '}
              · {STATS[data.stat].icon} {STATS[data.stat].label}
            </span>
          )}
        </h2>
        {data && <span class="muted small">{data.date} · UTC</span>}
      </div>
      {error && <p class="form-error">{error}</p>}
      {!rows && !error && <p class="muted center small">Loading…</p>}
      {rows && rows.length === 0 && <p class="muted center small">No finished runs yet today. Be the first!</p>}
      {rows && rows.length > 0 && (
        <table class="board">
          <thead>
            <tr class="board-cols">
              <th />
              <th />
              <th class="score" title="Correct answers in a row from the first question">
                Flawless
              </th>
              <th class="time">Correct</th>
              <th class="time">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row)}
            {youOutside && (
              <>
                <tr class="gap">
                  <td colSpan={5}>⋯</td>
                </tr>
                {row(youOutside, 'you')}
              </>
            )}
          </tbody>
        </table>
      )}
      {data && data.players > 0 && (
        <p class="muted small center board-foot">
          {data.players} {data.players === 1 ? 'player' : 'players'} today · ranked by flawless answers, then correct,
          then time
        </p>
      )}
    </section>
  );
}
