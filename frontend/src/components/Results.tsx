import type { GameActions, GameVM } from '../types';
import { Logo } from './common';

export function Results({ vm, actions }: { vm: GameVM; actions: GameActions }) {
  const res = vm.result!;
  const meSlot = vm.me;
  const oppSlot = meSlot === 0 ? 1 : 0;
  const me = vm.players[meSlot];
  const opp = vm.players[oppSlot];
  const iWon = res.winner === meSlot;
  const oppGone = opp.left || !opp.connected;

  const title = res.winner === null ? "It's a draw!" : iWon ? 'You win!' : `${opp.name} wins!`;
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
        <div class="btn-row">
          <button class="btn btn-primary" disabled={me.rematch || oppGone} onClick={actions.rematch}>
            {me.rematch ? 'Waiting…' : opp.rematch ? 'Accept rematch' : 'Rematch'}
          </button>
          <button class="btn btn-ghost" onClick={actions.leave}>
            Back to lobby
          </button>
        </div>
        {oppGone ? (
          <p class="rematch-note off">{opp.name} has left.</p>
        ) : me.rematch ? (
          <p class="rematch-note">Waiting for {opp.name} to accept…</p>
        ) : opp.rematch ? (
          <p class="rematch-note">{opp.name} wants a rematch!</p>
        ) : null}
      </section>

      {vm.history.length > 0 && (
        <section class="card rounds-card">
          <h2>Rounds</h2>
          <table class="rounds">
            <thead>
              <tr>
                <th>#</th>
                <th>Flag</th>
                <th class="left">Country</th>
                <th>Point</th>
                <th title="Wrong guesses">
                  ✗ <span class="th-sub">{me.name} / {opp.name}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {vm.history.map((r, i) => (
                <tr key={i}>
                  <td class="num">{i + 1}</td>
                  <td>
                    <img class="thumb" src={r.flagUrl} alt="" />
                  </td>
                  <td class="left country">{r.countryName}</td>
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
      )}
    </main>
  );
}
