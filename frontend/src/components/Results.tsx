import { useState } from 'preact/hooks';
import { DIVISIONS, DIVISION_IDS, MODES, divisionOf, type ModeId, type RankedView, type Slot } from '@flagduel/shared';
import type { GameActions, GameVM, RoundSummary } from '../types';
import { Logo } from './common';
import { RankUp } from './Emblem';
import { DivisionBadge, added } from './Ranked';

/** "1000 → 1078 (+78)", plus a promotion/demotion note. */
function RatingChange({ ranked, me }: { ranked: RankedView; me: Slot }) {
  const [celebrate, setCelebrate] = useState(true);
  const p = ranked.players[me];
  if (p.delta === null || p.after === null) return <p class="rating-change muted">Updating rating…</p>;
  const before = divisionOf(p.rating);
  const after = divisionOf(p.after);
  const moved = DIVISION_IDS.indexOf(after) - DIVISION_IDS.indexOf(before);
  return (
    <>
      <p class="rating-change">
        {MODES[ranked.mode].label} rating {p.rating} → {p.after}{' '}
        <span class={p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'muted'}>
          ({p.delta > 0 ? '+' : ''}
          {p.delta})
        </span>{' '}
        <DivisionBadge division={after} small />
      </p>
      {moved !== 0 && (
        <p class="banner-sub">
          {moved > 0
            ? `Promoted to ${DIVISIONS[after].label}! New regions are in play now.`
            : `Dropped to ${DIVISIONS[after].label}.`}
        </p>
      )}
      {moved > 0 && celebrate && (
        <RankUp
          division={after}
          kicker="Promoted!"
          detail={`${MODES[ranked.mode].label} rating ${p.after} · new regions ${added(after)}`}
          onClose={() => setCelebrate(false)}
        />
      )}
    </>
  );
}

/** Points per player in each minigame, in play order. */
function stageScores(vm: GameVM): { mode: ModeId; scores: [number, number] }[] {
  return vm.modes.map((mode) => {
    const scores: [number, number] = [0, 0];
    for (const r of vm.history) if (r.mode === mode && r.winner !== null) scores[r.winner]++;
    return { mode, scores };
  });
}

export function Results({ vm, actions }: { vm: GameVM; actions: GameActions }) {
  const res = vm.result!;
  const meSlot = vm.me;
  const oppSlot = meSlot === 0 ? 1 : 0;
  const me = vm.players[meSlot];
  const opp = vm.players[oppSlot];
  const iWon = res.winner === meSlot;
  const oppGone = opp.left || !opp.connected;

  const multi = vm.modes.length > 1;
  const title =
    res.winner === null
      ? "It's a draw!"
      : iWon
        ? multi
          ? 'You are the overall winner!'
          : 'You win!'
        : `${opp.name} wins${multi ? ' overall' : ''}!`;
  const byRoundMode = (mode: ModeId) =>
    vm.history.map((r, i) => [r, i] as [RoundSummary, number]).filter(([r]) => r.mode === mode);
  let sub = '';
  if (res.decidedBy === 'forfeit') {
    const who = iWon ? opp.name : 'You';
    sub =
      vm.forfeitReason === 'disconnected'
        ? `${who} lost connection and didn't come back.`
        : vm.forfeitReason === 'left'
          ? `${who} left the game.`
          : `${who} gave up.`;
  }
  if (res.decidedBy === 'tiebreaker') {
    const [a, b] = [res.wrongTotals[res.winner!], res.wrongTotals[res.winner === 0 ? 1 : 0]];
    sub = `Won on tie-breaker: ${a} vs ${b} wrong guesses`;
  }
  if (res.decidedBy === 'draw') sub = 'Same points and same number of wrong guesses.';

  return (
    <main class="stack">
      <section class={`card results-banner ${res.winner === null ? 'draw' : iWon ? 'win' : 'lose'}`}>
        <Logo size={52} />
        <h1>{title}</h1>
        {sub && <p class={`banner-sub${res.decidedBy === 'tiebreaker' ? ' tiebreak' : ''}`}>{sub}</p>}
        <div class="final-score">
          <div class="fs-player">
            <span class="fs-name">{me.name}</span>
            <span class="fs-points">{res.scores[meSlot]}</span>
            <span class={`fs-wrong${res.decidedBy === 'tiebreaker' ? ' hl' : ''}`}>
              {res.wrongTotals[meSlot]} wrong
            </span>
          </div>
          <span class="fs-colon">:</span>
          <div class="fs-player">
            <span class="fs-name">{opp.name}</span>
            <span class="fs-points">{res.scores[oppSlot]}</span>
            <span class={`fs-wrong${res.decidedBy === 'tiebreaker' ? ' hl' : ''}`}>
              {res.wrongTotals[oppSlot]} wrong
            </span>
          </div>
        </div>
        {multi && (
          <table class="stage-table">
            <thead>
              <tr>
                <th class="left">Game</th>
                <th>{me.name}</th>
                <th>{opp.name}</th>
              </tr>
            </thead>
            <tbody>
              {stageScores(vm).map(({ mode, scores }) => (
                <tr key={mode}>
                  <td class="left">{MODES[mode].label}</td>
                  <td class={scores[meSlot] > scores[oppSlot] ? 'lead' : ''}>{scores[meSlot]}</td>
                  <td class={scores[oppSlot] > scores[meSlot] ? 'lead' : ''}>{scores[oppSlot]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td class="left">Total</td>
                <td>{res.scores[meSlot]}</td>
                <td>{res.scores[oppSlot]}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {vm.ranked && <RatingChange ranked={vm.ranked} me={meSlot} />}
        {vm.ranked ? (
          <div class="btn-row">
            <button class="btn btn-primary" onClick={actions.rematch}>
              Find new match
            </button>
            <button class="btn btn-ghost" onClick={actions.leave}>
              Back
            </button>
          </div>
        ) : (
          <div class="btn-row">
            <button class="btn btn-primary" disabled={me.rematch || oppGone} onClick={actions.rematch}>
              {me.rematch ? 'Waiting…' : opp.rematch ? 'Accept rematch' : 'Rematch'}
            </button>
            <button class="btn btn-ghost" onClick={actions.leave}>
              Back to lobby
            </button>
          </div>
        )}
        {vm.ranked ? null : oppGone ? (
          <p class="rematch-note off">{opp.name} has left.</p>
        ) : me.rematch ? (
          <p class="rematch-note">Waiting for {opp.name} to accept…</p>
        ) : opp.rematch ? (
          <p class="rematch-note">{opp.name} wants a rematch!</p>
        ) : null}
      </section>

      {vm.modes
        .filter((mode) => byRoundMode(mode).length > 0)
        .map((mode) => (
          <section class="card rounds-card" key={mode}>
            <h2>{multi ? `${MODES[mode].label} rounds` : 'Rounds'}</h2>
            <table class="rounds">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Flag</th>
                  <th class="left">{mode === 'capitals' ? 'Capital' : 'Country'}</th>
                  <th>Point</th>
                  <th title="Wrong guesses">
                    ✗ <span class="th-sub">{me.name} / {opp.name}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {byRoundMode(mode).map(([r, i], k) => (
                  <tr key={i}>
                    <td class="num">{k + 1}</td>
                    <td>
                      <img class="thumb" src={r.flagUrl} alt="" />
                    </td>
                    <td class="left country">
                      {r.answer}
                      {r.mode === 'capitals' && <span class="of-country">{r.countryName}</span>}
                    </td>
                    <td>
                      {r.winner === null ? (
                        <span class="pill none">—</span>
                      ) : (
                        <span class={`pill ${r.winner === meSlot ? 'me' : 'opp'}`}>
                          {vm.players[r.winner].name}
                        </span>
                      )}
                    </td>
                    <td class="num">
                      {r.wrong[meSlot]} / {r.wrong[oppSlot]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
    </main>
  );
}
