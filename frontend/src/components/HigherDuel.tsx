import { useState } from 'preact/hooks';
import { COUNTDOWN_MS, DUEL_TIME_MS, STATS, type DuelRoundView, type RoomView, type Slot } from '@flagduel/shared';
import { codeFlagSrc } from '../api';
import { Logo, RegionChips, useNow } from './common';
import { GEO_KNOWLEDGE_LABEL, PairBoard, StatHeader, TimeBar, type PickTag } from './Higher';
import { VsIntro } from './VsIntro';

export interface DuelActions {
  pick(code: string): void;
  giveUp(): void;
  rematch(): void;
  /** Back to the lobby */
  leave(): void;
}

/** Each player's rounds as ✓/✗ tiles: regular rounds, then sudden-death rounds after a divider. */
function DuelTrack({
  history,
  regular,
  slot,
  name,
  current,
}: {
  history: DuelRoundView[];
  regular: number;
  slot: Slot;
  name: string;
  current: number | null;
}) {
  const total = Math.max(regular, history.length + (current !== null && current >= history.length ? 1 : 0));
  return (
    <div class="duel-track">
      <span class="duel-track-name">{name}</span>
      <ol class="streak-tiles">
        {Array.from({ length: total }, (_, i) => {
          const h = history[i];
          const state = h ? (h.correct[slot] ? 'ok' : 'miss') : i === current ? 'now' : 'todo';
          return (
            <li key={i} class={`st ${state}${i === regular ? ' sd-start' : ''}`} title={`Round ${i + 1}`}>
              {state === 'ok' ? '✓' : state === 'miss' ? '✗' : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function HigherDuelScreen({
  room,
  you,
  toLocal,
  actions,
}: {
  room: RoomView;
  you: Slot;
  toLocal: (serverMs: number | null) => number | null;
  actions: DuelActions;
}) {
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const d = room.higher!;
  const opp: Slot = you === 0 ? 1 : 0;
  const me = room.players[you];
  const them = room.players[opp];
  const countdownEndsAt = toLocal(room.countdownEndsAt);
  const deadline = toLocal(room.deadline);
  const now = useNow(room.phase === 'countdown' || them.graceEndsAt !== null, 100);
  const r = d.reveal;
  const pair = d.pair;
  const counting = room.phase === 'countdown' && countdownEndsAt !== null;
  const count = counting ? Math.min(COUNTDOWN_MS / 1000, Math.max(1, Math.ceil((countdownEndsAt - now) / 1000))) : 0;
  const tags: PickTag[] = r
    ? [
        ...(r.picks[you] ? [{ code: r.picks[you]!, label: 'You', kind: 'me' as const }] : []),
        ...(r.picks[opp] ? [{ code: r.picks[opp]!, label: them.name, kind: 'opp' as const }] : []),
      ]
    : [];
  const left = d.regularRounds - d.history.length;
  /** 1-based sudden-death round (the announcement counts down to the next one) */
  const sdRound = d.round - d.regularRounds + (counting ? 1 : 0);

  let status;
  if (r) {
    const [mine, theirs] = [r.correct[you], r.correct[opp]];
    const text =
      mine && theirs
        ? 'Both right — a point each'
        : mine
          ? `Point for you${r.picks[opp] === null ? ` — ${them.name} ran out of time` : ''}`
          : theirs
            ? `Point for ${them.name}${r.picks[you] === null ? ' — you ran out of time' : ''}`
            : 'Nobody got it';
    status = (
      <div class={`status-line reveal ${mine && !theirs ? 'win' : theirs && !mine ? 'lose' : 'none'}`}>
        <strong class="reveal-country">{r.answer === r.a ? r.aName : r.bName} is higher</strong>
        <span class="reveal-who">{text}</span>
      </div>
    );
  } else if (them.graceEndsAt !== null) {
    const g = toLocal(them.graceEndsAt)!;
    status = (
      <div class="status-line warn">
        {them.name} lost connection — you win in {Math.max(0, Math.ceil((g - now) / 1000))} s unless they come back
      </div>
    );
  } else if (counting) {
    status = <div class="status-line muted">Get ready…</div>;
  } else if (d.mine) {
    status = (
      <div class="status-line muted">
        Locked in — {d.picked[opp] ? `${them.name} has picked too…` : `waiting for ${them.name}…`}
      </div>
    );
  } else {
    status = (
      <div class="status-line muted hint">
        {d.picked[opp] ? `${them.name} has locked in. Your turn!` : 'Speed doesn’t matter — only being right'}
      </div>
    );
  }

  const introVm = {
    phase: room.phase,
    history: d.history,
    countdownEndsAt,
    me: you,
    players: room.players,
    ranked: null,
    modes: [],
  };

  return (
    <main class="stack">
      <VsIntro vm={introVm} label={`${GEO_KNOWLEDGE_LABEL} · ${d.regularRounds} rounds`} />
      {counting && d.tiebreak && <SuddenDeathIntro endsAt={countdownEndsAt} score={me.score} />}
      <section class="card top-card">
        <header class="brand">
          <Logo />
          <h1>
            {GEO_KNOWLEDGE_LABEL} <em>· {d.regularRounds} rounds</em>
          </h1>
        </header>
        <div class="status-row">
          <span class="round-label">
            {d.tiebreak ? `Sudden death · ${sdRound}` : `Round ${Math.max(1, d.round)}/${d.regularRounds}`}
          </span>
          <div class="scoreboard" aria-label={`${me.name} ${me.score}, ${them.name} ${them.score}`}>
            <span class="sb-name me">{me.name}</span>
            <span class="sb-score">
              {me.score}
              <span class="sb-colon">:</span>
              {them.score}
            </span>
            <span class="sb-name opp">{them.name}</span>
          </div>
          <span class="round-label side">{d.tiebreak ? 'first to lead wins' : `${Math.max(0, left)} left`}</span>
        </div>
        <div class="duel-tracks">
          <DuelTrack
            history={d.history}
            regular={d.regularRounds}
            slot={you}
            name="You"
            current={r ? null : d.round - 1}
          />
          <DuelTrack
            history={d.history}
            regular={d.regularRounds}
            slot={opp}
            name={them.name}
            current={r ? null : d.round - 1}
          />
        </div>
        {d.tiebreak && (
          <p class="hl-streak-note broken">
            Sudden death: the first round where only one of you is right wins the match.
          </p>
        )}
        <RegionChips regions={room.regions} />
      </section>

      <section class="card game-card hl-card">
        {counting || !pair ? (
          <>
            <div class="hl-head">
              <span class="hl-stat">A new category every round</span>
              <p class="hl-question">Pick the country with the higher value</p>
            </div>
            <div class="hl-countdown">
              <div class="countdown" key={count}>
                {count || ''}
              </div>
            </div>
          </>
        ) : (
          <>
            <StatHeader stat={pair.stat} kicker={d.tiebreak ? 'Sudden death' : `Round ${d.round}`} />
            <PairBoard
              key={d.round}
              pair={pair}
              revealed={r ? { values: r.values, answer: r.answer } : null}
              mine={r ? r.picks[you] : d.mine}
              tags={tags}
              locked={room.phase !== 'playing'}
              onPick={actions.pick}
            />
            <p class={`duel-opp${d.picked[opp] && !r ? ' in' : ''}`}>
              {r ? ' ' : d.picked[opp] ? `✓ ${them.name} has locked in` : `${them.name} is thinking…`}
            </p>
          </>
        )}
        <TimeBar deadline={room.phase === 'playing' ? deadline : null} total={DUEL_TIME_MS} />
        {status}
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

/** Full-screen announcement while the server counts down to the first sudden-death round. */
function SuddenDeathIntro({ endsAt, score }: { endsAt: number; score: number }) {
  const now = useNow(true, 100);
  const n = Math.max(1, Math.ceil((endsAt - now) / 1000));
  return (
    <div class="sd-intro" role="dialog" aria-modal="true" aria-label="Sudden death">
      <div class="sd-box">
        <span class="sd-kicker">
          Tied {score} : {score}
        </span>
        <strong class="sd-title">Sudden death</strong>
        <span class="sd-desc">The first round where only one of you is right wins the match.</span>
        <span class="sd-num" key={n}>
          {n}
        </span>
      </div>
    </div>
  );
}

export function HigherDuelResults({ room, you, actions }: { room: RoomView; you: Slot; actions: DuelActions }) {
  const res = room.result!;
  const d = room.higher!;
  const opp: Slot = you === 0 ? 1 : 0;
  const me = room.players[you];
  const them = room.players[opp];
  const iWon = res.winner === you;
  const oppGone = them.left || !them.connected;
  const suddenDeath = d.history.length - d.regularRounds;

  let sub = '';
  if (res.decidedBy === 'forfeit') {
    const who = iWon ? them.name : 'You';
    sub =
      room.forfeitReason === 'disconnected'
        ? `${who} lost connection and didn't come back.`
        : room.forfeitReason === 'left'
          ? `${who} left the game.`
          : `${who} gave up.`;
  } else if (res.decidedBy === 'tiebreaker') {
    sub = `Tied after ${d.regularRounds} — decided in sudden death (round ${suddenDeath}).`;
  } else if (res.decidedBy === 'draw') {
    sub = 'Still level after sudden death.';
  }

  return (
    <main class="stack">
      <section class={`card results-banner ${res.winner === null ? 'draw' : iWon ? 'win' : 'lose'}`}>
        <Logo size={52} />
        <h1>{res.winner === null ? "It's a draw!" : iWon ? 'You win!' : `${them.name} wins!`}</h1>
        {sub && <p class={`banner-sub${res.decidedBy === 'tiebreaker' ? ' tiebreak' : ''}`}>{sub}</p>}
        <div class="final-score">
          <div class="fs-player">
            <span class="fs-name">{me.name}</span>
            <span class="fs-points">{res.scores[you]}</span>
            <span class="fs-wrong">{res.wrongTotals[you]} wrong</span>
          </div>
          <span class="fs-colon">:</span>
          <div class="fs-player">
            <span class="fs-name">{them.name}</span>
            <span class="fs-points">{res.scores[opp]}</span>
            <span class="fs-wrong">{res.wrongTotals[opp]} wrong</span>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" disabled={me.rematch || oppGone} onClick={actions.rematch}>
            {me.rematch ? 'Waiting…' : them.rematch ? 'Accept rematch' : 'Rematch'}
          </button>
          <button class="btn btn-ghost" onClick={actions.leave}>
            Back to lobby
          </button>
        </div>
        {oppGone ? (
          <p class="rematch-note off">{them.name} has left.</p>
        ) : me.rematch ? (
          <p class="rematch-note">Waiting for {them.name} to accept…</p>
        ) : them.rematch ? (
          <p class="rematch-note">{them.name} wants a rematch!</p>
        ) : null}
      </section>

      {d.history.length > 0 && (
        <section class="card rounds-card">
          <h2>Rounds</h2>
          <table class="rounds hl-rounds">
            <thead>
              <tr>
                <th>#</th>
                <th class="left">Category</th>
                <th class="left">Higher</th>
                <th class="left">Lower</th>
                <th>You</th>
                <th>{them.name}</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((h, i) => {
                const hi = h.answer === h.a ? 0 : 1;
                const names = [h.aName, h.bName];
                const codes = [h.a, h.b];
                const s = STATS[h.stat];
                return (
                  <tr key={i} class={h.tiebreak && i === d.regularRounds ? 'sd-row' : ''}>
                    <td class="num">{h.tiebreak ? `SD${i - d.regularRounds + 1}` : i + 1}</td>
                    <td class="left">
                      <span aria-hidden="true">{s.icon}</span> {s.label}
                    </td>
                    {[hi, 1 - hi].map((k) => (
                      <td class="left" key={k}>
                        <span class="hl-cell">
                          <img class="thumb" src={codeFlagSrc(codes[k])} alt="" />
                          <span>
                            {names[k]}
                            <span class="of-country">{s.format(h.values[k])}</span>
                          </span>
                        </span>
                      </td>
                    ))}
                    {[you, opp].map((slot) => (
                      <td key={slot}>
                        <span class={`pill ${h.correct[slot] ? (slot === you ? 'me' : 'opp') : 'none'}`}>
                          {h.correct[slot] ? '✓' : h.picks[slot] === null ? 'time' : '✗'}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
