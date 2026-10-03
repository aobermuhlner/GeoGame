// Challenges (#/challenges): fixed tasks against the clock, e.g. "name every country in Europe". Each has a
// bronze, silver and gold medal that differ only in the time allowed. A run is played in the browser; a
// completed one is sent to the server, which keeps the best time per challenge (the medal follows from it).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CHALLENGES,
  CHALLENGE_BY_ID,
  COUNTRY_BY_CODE,
  MEDAL_IDS,
  MEDAL_LABELS,
  REGION_IDS,
  REGION_LABELS,
  WORLD_CHALLENGE,
  challengeCodes,
  challengeStanding,
  isLivePrefix,
  medalForTime,
  medalRank,
  submitText,
  typeText,
  type Challenge,
  type ChallengeBests,
  type Held,
  type MedalId,
  type RegionId,
  type TypingNotice,
  type TypingResult,
} from '@flagduel/shared';
import { api } from '../api';
import type { WORLD_MAP } from '../generated/worldmap';
import { formatClock, formatDuration, useNow } from './common';
import { LocateMap, type Mark } from './LocateMap';

const nameOf = (code: string) => COUNTRY_BY_CODE[code]?.name ?? code;

export function MedalBadge({ medal, size = 22 }: { medal: MedalId | null; size?: number }) {
  return (
    <svg class={`medal ${medal ?? 'none'}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" />
      <circle class="inner" cx="12" cy="12" r="7" />
      {medal && <path class="star" d="M12 7.6l1.3 2.7 3 .4-2.2 2.1.5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.2-2.1 3-.4z" />}
    </svg>
  );
}

// ---------- Lobby map: each region in the colour of its medal ----------

/** Which challenge a region of the lobby map stands for. */
const CHALLENGE_OF_REGION = Object.fromEntries(
  CHALLENGES.flatMap((c) => c.regions.map((r): [RegionId, Challenge] => [r, c])),
) as Record<RegionId, Challenge>;

function MedalMap({ bests, onPick }: { bests: ChallengeBests; onPick: (c: Challenge) => void }) {
  const [map, setMap] = useState<typeof WORLD_MAP | null>(null);
  useEffect(() => {
    let alive = true;
    import('../generated/worldmap').then((m) => alive && setMap(m.WORLD_MAP));
    return () => {
      alive = false;
    };
  }, []);
  if (!map) return <div class="world-map medal-map loading" aria-hidden="true" />;

  return (
    <svg class="world-map medal-map" viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label="Your medals by region">
      <path class="map-other" d={map.other} />
      {REGION_IDS.map((r) => {
        const ch = CHALLENGE_OF_REGION[r];
        const { medal } = challengeStanding(ch, bests);
        const label = `${ch.label}: ${medal ? `${MEDAL_LABELS[medal]} medal` : 'no medal yet'}`;
        return (
          <g
            key={r}
            class={`medal-region ${medal ?? 'none'}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={() => onPick(ch)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(ch);
              }
            }}
          >
            <title>{label}</title>
            <path class="shape" d={map.regions[r]} />
            {map.dots[r].map(([x, y], i) => (
              <circle key={i} class="dot" cx={x} cy={y} r={3.2} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Lobby (#/challenges) ----------

function ChallengeRow({
  ch,
  bests,
  active,
  onPlay,
}: {
  ch: Challenge;
  bests: ChallengeBests;
  active: boolean;
  onPlay: (m: MedalId) => void;
}) {
  const { own, medal, bestMs } = challengeStanding(ch, bests);
  const count = challengeCodes(ch).length;
  return (
    <article id={`ch-${ch.id}`} class={`challenge-row${active ? ' active' : ''}${ch.id === WORLD_CHALLENGE ? ' world' : ''}`}>
      <div class="ch-head">
        <MedalBadge medal={medal} size={30} />
        <div class="ch-text">
          <h3>{ch.label}</h3>
          <p class="muted small">
            {count} countries
            {bestMs !== null && <> · best {formatDuration(bestMs)}</>}
            {medal && medalRank(medal) > medalRank(own) && <> · {MEDAL_LABELS[medal]} through the whole world</>}
          </p>
        </div>
      </div>
      <div class="ch-medals" role="group" aria-label={`Play ${ch.label}`}>
        {MEDAL_IDS.map((m) => (
          <button
            key={m}
            class={`ch-medal ${m}${medalRank(medal) >= medalRank(m) ? ' won' : ''}`}
            title={`${MEDAL_LABELS[m]}: name all ${count} countries in ${formatClock(ch.limits[m])}`}
            onClick={() => onPlay(m)}
          >
            <span class="ch-medal-name">{MEDAL_LABELS[m]}</span>
            <span class="ch-medal-time">{formatClock(ch.limits[m])}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function ChallengeHub({
  bests,
  error,
  onPlay,
}: {
  bests: ChallengeBests | null;
  error: string | null;
  onPlay: (id: string, m: MedalId) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const shown = bests ?? {};

  function pick(ch: Challenge) {
    setActive(ch.id);
    document.getElementById(`ch-${ch.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return (
    <main class="stack challenges">
      <section class="card">
        <h2 class="page-title">Challenges</h2>
        <p class="muted small rules">
          Name every country of a region before the clock runs out. There are no suggestions: spell a country
          out and it's in. Bronze, silver and gold differ only in the time you get, and naming the whole world
          counts for every region.
        </p>
        <MedalMap bests={shown} onPick={pick} />
        <ul class="medal-legend" aria-label="Legend">
          {MEDAL_IDS.map((m) => (
            <li key={m}>
              <MedalBadge medal={m} size={16} /> {MEDAL_LABELS[m]}
            </li>
          ))}
        </ul>
        {error && <p class="error small center">{error}</p>}
      </section>

      <section class="card">
        <div class="regions-head">
          <h2>Countries</h2>
        </div>
        <div class="challenge-list">
          {[CHALLENGE_BY_ID[WORLD_CHALLENGE], ...CHALLENGES.filter((c) => c.id !== WORLD_CHALLENGE)].map((ch) => (
            <ChallengeRow key={ch.id} ch={ch} bests={shown} active={active === ch.id} onPlay={(m) => onPlay(ch.id, m)} />
          ))}
        </div>
      </section>
    </main>
  );
}

// ---------- A run ----------

type Phase = 'ready' | 'playing' | 'won' | 'lost';

function noticeText(n: TypingNotice, ch: Challenge): string {
  switch (n.kind) {
    case 'unknown':
      return `“${n.text}” isn't a country — check the spelling.`;
    case 'repeat':
      return `${nameOf(n.code)} is already in.`;
    case 'outside': {
      const region = COUNTRY_BY_CODE[n.code]?.region;
      return `${nameOf(n.code)} is ${region ? `in ${REGION_LABELS[region]}` : 'not part of this challenge'}, not ${ch.label}.`;
    }
  }
}

function ChallengeGame({
  ch,
  medal,
  onExit,
  onImmersive,
  onBests,
}: {
  ch: Challenge;
  medal: MedalId;
  onExit: () => void;
  onImmersive: (on: boolean) => void;
  onBests: (b: ChallengeBests) => void;
}) {
  const pool = useMemo(() => new Set(challengeCodes(ch)), [ch]);
  const limit = ch.limits[medal];
  const [phase, setPhase] = useState<Phase>('ready');
  const [startedAt, setStartedAt] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [found, setFound] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [held, setHeld] = useState<Held | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean; key: number } | null>(null);
  const [saved, setSaved] = useState<{ improved: boolean } | 'error' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const foundSet = useMemo(() => new Set(found), [found]);
  const now = useNow(phase === 'playing', 100);
  const elapsed = phase === 'playing' ? now - startedAt : endMs;
  const left = limit - elapsed;

  useEffect(() => {
    onImmersive(phase === 'playing');
    return () => onImmersive(false);
  }, [phase]);

  useEffect(() => {
    if (phase === 'playing') inputRef.current?.focus();
  }, [phase]);

  // Out of time.
  useEffect(() => {
    if (phase === 'playing' && left <= 0) finish('lost', limit);
  }, [phase, left <= 0]);

  function start() {
    setStartedAt(Date.now());
    setPhase('playing');
  }

  function finish(result: 'won' | 'lost', ms: number, codes = found) {
    setEndMs(ms);
    setPhase(result);
    setText('');
    setHeld(null);
    if (result === 'won') {
      api
        .challengeResult(ch.id, codes, ms)
        .then((r) => {
          onBests(r.bests);
          setSaved({ improved: r.improved });
        })
        .catch(() => setSaved('error'));
    }
  }

  function apply(r: TypingResult) {
    setText(r.text);
    setHeld(r.held);
    if (r.notice) setNotice({ text: noticeText(r.notice, ch), bad: true, key: Date.now() });
    if (r.added.length) {
      const next = [...found, ...r.added];
      setFound(next);
      setNotice({ text: `✓ ${r.added.map(nameOf).join(', ')}`, bad: false, key: Date.now() });
      if (next.length === pool.size) finish('won', Math.min(Date.now() - startedAt, limit), next);
    }
  }

  const marks = useMemo(() => {
    const m: Record<string, Mark> = {};
    for (const c of found) m[c] = 'correct';
    if (phase === 'lost') for (const c of pool) if (!foundSet.has(c)) m[c] = 'missed';
    return m;
  }, [found, phase]);

  const missed = phase === 'lost' ? challengeCodes(ch).filter((c) => !foundSet.has(c)) : [];
  const earned = phase === 'won' ? medalForTime(ch, endMs) : null;
  const typing = phase === 'playing';
  const dead = typing && text.trim().length >= 2 && !isLivePrefix(text);
  const waiting = typing && held && !held.added && held.text === text;
  // Per-region progress when a challenge spans several regions.
  const regions: RegionId[] = ch.regions.length ? [...ch.regions] : [...REGION_IDS];
  const perRegion = regions.length > 1 ? regions.map((r) => {
    const codes = challengeCodes(ch).filter((c) => COUNTRY_BY_CODE[c].region === r);
    return { r, total: codes.length, got: codes.filter((c) => foundSet.has(c)).length };
  }) : [];

  return (
    <main class="stack wide challenge-game">
      <section class="card challenge-top">
        <div class="cg-head">
          <MedalBadge medal={medal} size={28} />
          <div class="cg-title">
            <h2>{ch.label}</h2>
            <span class="muted small">
              {MEDAL_LABELS[medal]} · {formatClock(limit)}
            </span>
          </div>
          <div class="cg-stats">
            <span class="cg-count">
              <b>{found.length}</b> / {pool.size}
            </span>
            <span class={`cg-clock${typing && left < 20_000 ? ' urgent' : ''}`}>{formatClock(phase === 'won' ? limit - endMs : left)}</span>
          </div>
        </div>

        {phase === 'ready' && (
          <div class="cg-ready">
            <p>
              Name all <b>{pool.size}</b> countries of {ch.id === WORLD_CHALLENGE ? 'the world' : ch.label} in <b>{formatClock(limit)}</b>. A country is entered
              as soon as it's spelled right; common short forms count too (UK, USA, DRC…).
            </p>
            <div class="btn-row">
              <button class="btn btn-ghost" onClick={onExit}>
                Back
              </button>
              <button class="btn btn-lg btn-primary" onClick={start}>
                Start
              </button>
            </div>
          </div>
        )}

        {typing && (
          <form
            class="cg-form"
            onSubmit={(e) => {
              e.preventDefault();
              apply(submitText(text, held, pool, foundSet));
            }}
          >
            <input
              ref={inputRef}
              class={`cg-input${dead ? ' bad' : ''}`}
              value={text}
              placeholder="Type a country…"
              aria-label="Country name"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              enterKeyHint="enter"
              onInput={(e) => apply(typeText((e.currentTarget as HTMLInputElement).value, held, pool, foundSet))}
            />
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => finish('lost', Date.now() - startedAt)}>
              Give up
            </button>
          </form>
        )}
        {typing && (
          <p class={`cg-notice${dead || (!waiting && notice?.bad) ? ' bad' : ''}`} key={notice?.key} aria-live="polite">
            {waiting
              ? `Press Enter for ${nameOf(held.code)} (or keep typing)`
              : dead
                ? 'No country starts like that — check the spelling.'
                : (notice?.text ?? ' ')}
          </p>
        )}

        {phase === 'won' && (
          <div class="cg-result won">
            <MedalBadge medal={earned} size={56} />
            <div>
              <h3>
                {earned ? `${MEDAL_LABELS[earned]}!` : 'Done!'} All {pool.size} in {formatDuration(endMs)}
              </h3>
              <p class="muted small">
                {earned && medalRank(earned) > medalRank(medal) && <>Fast enough for {MEDAL_LABELS[earned].toLowerCase()}. </>}
                {saved === null
                  ? 'Saving…'
                  : saved === 'error'
                    ? 'Could not save this result.'
                    : saved.improved
                      ? 'New personal best.'
                      : 'Not faster than your best.'}
              </p>
            </div>
          </div>
        )}
        {phase === 'lost' && (
          <div class="cg-result lost">
            <h3>
              {elapsed >= limit ? "Time's up" : 'Given up'} — {found.length} of {pool.size}
            </h3>
            <p class="muted small">Missed ({missed.length}):</p>
            <ul class="cg-missed">
              {missed.map((c) => (
                <li key={c}>{nameOf(c)}</li>
              ))}
            </ul>
          </div>
        )}
        {(phase === 'won' || phase === 'lost') && (
          <div class="btn-row">
            <button class="btn btn-ghost" onClick={onExit}>
              Challenges
            </button>
            <button class="btn btn-primary" onClick={onRetry}>
              Play again
            </button>
          </div>
        )}
      </section>

      {perRegion.length > 0 && (
        <ul class="cg-regions" aria-label="Progress by region">
          {perRegion.map(({ r, got, total }) => (
            <li key={r} class={got === total ? 'done' : ''}>
              {REGION_LABELS[r]} <b>{got}</b>/{total}
            </li>
          ))}
        </ul>
      )}

      <section class="card map-card">
        <LocateMap region={ch.regions.length ? ch.regions : null} snug active={ch.regions.length ? pool : null} marks={marks} labels={missed} nameOf={nameOf} disabled />
      </section>
    </main>
  );

  function onRetry() {
    setFound([]);
    setText('');
    setHeld(null);
    setNotice(null);
    setSaved(null);
    setEndMs(0);
    start();
  }
}

// ---------- Tab ----------

export function Challenges({ onImmersive }: { onImmersive: (on: boolean) => void }) {
  const [bests, setBests] = useState<ChallengeBests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [play, setPlay] = useState<{ id: string; medal: MedalId } | null>(null);

  useEffect(() => {
    api
      .challenges()
      .then((r) => setBests(r.bests))
      .catch((e: Error) => setError(e.message));
  }, []);

  const ch = play ? CHALLENGE_BY_ID[play.id] : null;
  if (play && ch) {
    return (
      <ChallengeGame
        key={`${play.id}/${play.medal}`}
        ch={ch}
        medal={play.medal}
        onExit={() => setPlay(null)}
        onImmersive={onImmersive}
        onBests={setBests}
      />
    );
  }
  return <ChallengeHub bests={bests} error={error} onPlay={(id, medal) => setPlay({ id, medal })} />;
}
