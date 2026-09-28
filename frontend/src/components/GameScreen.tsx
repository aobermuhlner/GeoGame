import { useState } from 'preact/hooks';
import { COUNTDOWN_MS, MODES, ROUND_TIME_MS, focusOf, isModeId, type ModeId } from '@flagduel/shared';
import type { GameActions, GameVM } from '../types';
import { CountryInput } from './CountryInput';
import { LocateBoard } from './LocateBoard';
import { LockLines, PhotoCredit, RevealMap, SentenceCard, ZoomPhoto } from './RoundPrompt';
import { Logo, RegionChips, StageSteps, formatClock, useNow } from './common';
import { VsIntro } from './VsIntro';

/** Minigame being played (this screen never shows a Higher or Lower stage). */
const modeOf = (vm: GameVM): ModeId => {
  const g = vm.modes[vm.stage];
  return g && isModeId(g) ? g : 'flags';
};

export function TopCard({ vm }: { vm: GameVM }) {
  const now = useNow(vm.deadline !== null);
  const me = vm.players[vm.me];
  const opp = vm.players[vm.me === 0 ? 1 : 0];
  const left = vm.deadline ? vm.deadline - now : null;
  const done = vm.history.length;
  const mode = MODES[modeOf(vm)];

  return (
    <section class="card top-card">
      <header class="brand">
        <Logo />
        <h1>
          {mode.lockIn ? (
            <>
              {mode.title(vm.stageRounds)} <em>· One Answer Each</em>
            </>
          ) : (
            <>
              {mode.title(vm.stageRounds)} As <em>Fast as You Can!</em>
            </>
          )}
        </h1>
      </header>
      {vm.modes.length > 1 && <StageSteps modes={vm.modes} current={vm.stage} />}
      <div class="status-row">
        <span class="round-label">
          Round {Math.max(1, vm.stageRound)}/{vm.stageRounds}
        </span>
        <div class="scoreboard" aria-label={`${me.name} ${me.score}, ${opp.name} ${opp.score}`}>
          <span class="sb-name me">{me.name}</span>
          <span class="sb-score">
            {me.score}
            <span class="sb-colon">:</span>
            {opp.score}
          </span>
          <span class="sb-name opp">
            {opp.name}
            {vm.oppWrongSeq > 0 && (
              <span class="opp-wrong" key={vm.oppWrongSeq} aria-hidden="true">
                ✗
              </span>
            )}
          </span>
        </div>
        <span class={`timer${left !== null && left <= 5000 ? ' urgent' : ''}`}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M8 9V6M6 1.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          {left !== null ? formatClock(left) : '–:––'}
        </span>
      </div>
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={vm.totalRounds} aria-valuenow={done}>
        <div class="progress-fill" style={{ width: `${(done / Math.max(1, vm.totalRounds)) * 100}%` }} />
      </div>
      <RegionChips regions={vm.regions} />
    </section>
  );
}

/** Round, score and clock in one line, for the full-screen map (where the top card is hidden). */
function MapHud({ vm }: { vm: GameVM }) {
  const now = useNow(vm.deadline !== null);
  const me = vm.players[vm.me];
  const opp = vm.players[vm.me === 0 ? 1 : 0];
  const left = vm.deadline ? vm.deadline - now : null;
  return (
    <>
      <span>
        {Math.max(1, vm.stageRound)}/{vm.stageRounds}
      </span>
      <span>
        You {me.score}:{opp.score} {opp.name}
      </span>
      <span class={left !== null && left <= 5000 ? 'urgent' : ''}>{left !== null ? formatClock(left) : '–:––'}</span>
    </>
  );
}

/** Shows a placeholder until the SVG has arrived, so a slow download never flashes half a flag. */
export function FlagImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <div class="flag-skeleton" aria-hidden="true" />}
      <img
        class={`flag${loaded ? '' : ' pending'}`}
        src={src}
        alt="Flag to guess"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </>
  );
}

/** What the round shows: a flag, a zooming landmark photo, or a sentence (kept through the reveal). */
function RoundPrompt({ vm }: { vm: GameVM }) {
  const m = MODES[modeOf(vm)];
  const r = vm.phase === 'reveal' ? vm.reveal : null;
  if (m.prompt === 'photo') {
    const src = vm.flagUrl ?? r?.flagUrl;
    const focus = vm.focus ?? (r ? focusOf(r.code) : null);
    if (!src || !focus) return null;
    const startedAt = vm.deadline !== null ? vm.deadline - ROUND_TIME_MS : null;
    return <ZoomPhoto key={src} src={src} focus={focus} startedAt={startedAt} full={vm.phase !== 'playing'} />;
  }
  if (m.prompt === 'sentence') {
    const text = vm.prompt ?? (r ? (m.promptText?.(r.code) ?? null) : null);
    return text ? <SentenceCard text={text} translation={r?.detail} /> : null;
  }
  return vm.flagUrl ? <FlagImage src={vm.flagUrl} key={vm.flagUrl} /> : null;
}

function Countdown({ endsAt, vm }: { endsAt: number; vm: GameVM }) {
  const now = useNow(true, 100);
  // The match's first countdown also covers the VsIntro; count only the part after it.
  const cap = vm.history.length === 0 ? COUNTDOWN_MS / 1000 : Infinity;
  const n = Math.min(cap, Math.max(1, Math.ceil((endsAt - now) / 1000)));
  if (vm.modes.length < 2) {
    return (
      <div class="countdown" key={n}>
        {n}
      </div>
    );
  }
  // Multi-game match: say which minigame is next and what to do.
  const mode = MODES[modeOf(vm)];
  return (
    <div class="countdown intro">
      <span class="intro-kicker">
        {vm.stage === 0 ? 'First up' : 'Next up'} · game {vm.stage + 1} of {vm.modes.length}
      </span>
      <strong class="intro-title">{mode.label}</strong>
      <span class="intro-desc">{mode.description}</span>
      <span class="intro-num" key={n}>
        {n}
      </span>
    </div>
  );
}

function StatusLine({ vm }: { vm: GameVM }) {
  const oppSlot = vm.me === 0 ? 1 : 0;
  const me = vm.players[vm.me];
  const opp = vm.players[oppSlot];
  const now = useNow(opp.graceEndsAt !== null, 500);
  if (vm.reveal && MODES[vm.reveal.mode].lockIn) {
    const { answer, end, mode, detail, locks, points } = vm.reveal;
    const mine = points[vm.me];
    const theirs = points[oppSlot];
    return (
      <div class={`status-line reveal ${mine === theirs ? 'none' : mine > theirs ? 'win' : 'lose'}`}>
        <strong class="reveal-country">{answer}</strong>
        {mode === 'landmarks' && detail && <span class="reveal-of">{detail}</span>}
        {locks ? (
          <LockLines locks={locks} points={points} names={[vm.players[0].name, vm.players[1].name]} me={vm.me} />
        ) : (
          <span class="reveal-who">{end === 'timeout' ? "Time's up — nobody answered" : 'Nobody answered'}</span>
        )}
      </div>
    );
  }
  if (vm.reveal) {
    const { winner, countryName, answer, end, mode } = vm.reveal;
    const who = winner === null ? null : winner === vm.me ? 'You' : opp.name;
    return (
      <div class={`status-line reveal ${winner === null ? 'none' : winner === vm.me ? 'win' : 'lose'}`}>
        <strong class="reveal-country">{answer}</strong>
        {mode === 'capitals' && <span class="reveal-of">capital of {countryName}</span>}
        <span class="reveal-who">
          {who ? `${who} got the point!` : end === 'timeout' ? "Time's up — no point" : 'No point'}
        </span>
      </div>
    );
  }
  if (opp.graceEndsAt !== null) {
    return (
      <div class="status-line warn">
        {opp.name} lost connection — you win in {Math.max(0, Math.ceil((opp.graceEndsAt - now) / 1000))} s unless they
        come back
      </div>
    );
  }
  if (vm.phase === 'countdown') return <div class="status-line muted">Get ready…</div>;
  if (me.passed) {
    const map = MODES[modeOf(vm)].input === 'map';
    return (
      <div class="status-line muted">
        {map ? "You're out this round" : 'You passed'} — waiting for {opp.name}…
      </div>
    );
  }
  if (MODES[modeOf(vm)].lockIn) {
    if (me.locked)
      return (
        <div class="status-line muted">
          <span>
            Locked in: <strong class="locked-answer">{vm.myLock ?? '…'}</strong>
          </span>
          <span>{opp.locked || opp.passed ? 'Revealing…' : `Waiting for ${opp.name}…`}</span>
        </div>
      );
    if (opp.locked) return <div class="status-line muted">{opp.name} has locked in an answer!</div>;
    if (opp.passed) return <div class="status-line muted">{opp.name} passed.</div>;
    return <div class="status-line muted hint">One answer each · right = 1 point, first right +1</div>;
  }
  if (opp.passed) return <div class="status-line muted">{opp.name} passed. It's all yours!</div>;
  return <div class="status-line muted hint">First correct answer wins the point</div>;
}

export function GameScreen({ vm, actions }: { vm: GameVM; actions: GameActions }) {
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const me = vm.players[vm.me];
  const locked = vm.phase !== 'playing' || me.passed || me.locked;
  const mode = MODES[modeOf(vm)];
  const isMap = mode.input === 'map' && !(vm.phase === 'reveal' && vm.reveal?.mode !== 'locate');

  const giveUp = (withPass: boolean) => (
    <div class="give-up">
      {withPass && (
        <button class="btn btn-sm btn-pass" type="button" disabled={locked} onClick={actions.pass}>
          Pass
        </button>
      )}
      {confirmGiveUp ? (
        <span class="confirm">
          Forfeit the whole match?{' '}
          <button class="link danger" onClick={actions.giveUp}>
            Yes, give up
          </button>{' '}
          <button class="link" onClick={() => setConfirmGiveUp(false)}>
            Keep playing
          </button>
        </span>
      ) : (
        <button class="link danger" onClick={() => setConfirmGiveUp(true)}>
          Give up
        </button>
      )}
    </div>
  );

  if (isMap) {
    return (
      <main class="stack wide">
        <VsIntro vm={vm} />
        <TopCard vm={vm} />
        <section class="card game-card map-card">
          <LocateBoard
            prompt={vm.phase === 'countdown' ? null : (vm.prompt ?? vm.reveal?.countryName ?? null)}
            flagUrl={vm.phase === 'countdown' ? null : vm.flagUrl}
            roundKey={vm.round + (vm.phase === 'countdown' ? 1000 : 0)}
            locked={locked}
            regions={vm.regions}
            answerCode={vm.phase === 'reveal' ? (vm.reveal?.code ?? null) : null}
            onGuess={actions.guess}
            onPass={actions.pass}
            overlay={
              vm.phase === 'countdown' && vm.countdownEndsAt ? <Countdown endsAt={vm.countdownEndsAt} vm={vm} /> : null
            }
            status={<StatusLine vm={vm} />}
            hud={<MapHud vm={vm} />}
          />
          {giveUp(false)}
        </section>
      </main>
    );
  }

  return (
    <main class="stack">
      <VsIntro vm={vm} />
      <TopCard vm={vm} />
      <section class="card game-card">
        <div class="round-badge" aria-label={`Round ${Math.max(1, vm.stageRound)}`}>
          {Math.max(1, vm.stageRound)}
        </div>
        <div class={`flag-frame ${mode.prompt}-prompt`}>
          {vm.phase === 'countdown' && vm.countdownEndsAt ? (
            <Countdown endsAt={vm.countdownEndsAt} vm={vm} />
          ) : (
            <RoundPrompt vm={vm} />
          )}
        </div>
        {vm.prompt && vm.phase === 'playing' && mode.prompt === 'flag' && (
          <p class="prompt">
            Capital of <strong>{vm.prompt}</strong>?
          </p>
        )}
        <StatusLine vm={vm} />
        {vm.phase === 'reveal' && vm.reveal?.mode === 'landmarks' && vm.reveal.country && (
          <>
            <RevealMap country={vm.reveal.country} landmark={vm.reveal.code} />
            <PhotoCredit id={vm.reveal.code} />
          </>
        )}
        <div class="guess-row">
          <CountryInput
            locked={locked}
            focusKey={vm.round}
            onSubmit={actions.guess}
            suggest={mode.suggest}
            placeholder={mode.placeholder}
            submitLabel={mode.lockIn ? 'Lock in' : undefined}
          />
        </div>
        {giveUp(true)}
      </section>
    </main>
  );
}
