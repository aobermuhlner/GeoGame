import { useState } from 'preact/hooks';
import type { GameActions, GameVM } from '../types';
import { CountryInput } from './CountryInput';
import { Logo, RegionChips, formatClock, useNow } from './common';

export function TopCard({ vm }: { vm: GameVM }) {
  const now = useNow(vm.deadline !== null);
  const me = vm.players[vm.me];
  const opp = vm.players[vm.me === 0 ? 1 : 0];
  const left = vm.deadline ? vm.deadline - now : null;
  const done = vm.history.length;

  return (
    <section class="card top-card">
      <header class="brand">
        <Logo />
        <h1>
          Guess {vm.totalRounds} Flags As <em>Fast as You Can!</em>
        </h1>
      </header>
      <div class="status-row">
        <span class="round-label">
          Round {vm.round}/{vm.totalRounds}
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
      <div
        class="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={vm.totalRounds}
        aria-valuenow={done}
      >
        <div class="progress-fill" style={{ width: `${(done / Math.max(1, vm.totalRounds)) * 100}%` }} />
      </div>
      <RegionChips regions={vm.regions} />
    </section>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const now = useNow(true, 100);
  const n = Math.max(1, Math.ceil((endsAt - now) / 1000));
  return (
    <div class="countdown" key={n}>
      {n}
    </div>
  );
}

function StatusLine({ vm }: { vm: GameVM }) {
  const oppSlot = vm.me === 0 ? 1 : 0;
  const me = vm.players[vm.me];
  const opp = vm.players[oppSlot];
  if (vm.reveal) {
    const { winner, countryName, end } = vm.reveal;
    const who = winner === null ? null : winner === vm.me ? 'You' : opp.name;
    return (
      <div class={`status-line reveal ${winner === null ? 'none' : winner === vm.me ? 'win' : 'lose'}`}>
        <strong class="reveal-country">{countryName}</strong>
        <span class="reveal-who">
          {who ? `${who} got the point!` : end === 'timeout' ? "Time's up — no point" : 'No point'}
        </span>
      </div>
    );
  }
  if (vm.phase === 'countdown') return <div class="status-line muted">Get ready…</div>;
  if (me.passed) return <div class="status-line muted">You passed — waiting for {opp.name}…</div>;
  if (opp.passed) return <div class="status-line muted">{opp.name} passed. It's all yours!</div>;
  return <div class="status-line muted hint">First correct answer wins the point</div>;
}

export function GameScreen({ vm, actions }: { vm: GameVM; actions: GameActions }) {
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const me = vm.players[vm.me];
  const locked = vm.phase !== 'playing' || me.passed;

  return (
    <main class="stack">
      <TopCard vm={vm} />
      <section class="card game-card">
        <div class="round-badge" aria-label={`Round ${vm.round}`}>
          {vm.round}
        </div>
        <div class="flag-frame">
          {vm.phase === 'countdown' && vm.countdownEndsAt ? (
            <Countdown endsAt={vm.countdownEndsAt} />
          ) : vm.flagUrl ? (
            <img class="flag" src={vm.flagUrl} alt="Flag to guess" draggable={false} key={vm.flagUrl} />
          ) : null}
        </div>
        <StatusLine vm={vm} />
        <div class="guess-row">
          <CountryInput locked={locked} focusKey={vm.round} onSubmit={actions.guess} />
          <button class="btn btn-primary" type="button" disabled={locked} onClick={actions.pass}>
            Pass
          </button>
        </div>
        <div class="give-up">
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
      </section>
    </main>
  );
}
