import { useEffect, useState } from 'preact/hooks';
import { BOARD_IDS, MODES, type BoardId, type LeaderboardResponse } from '@flagduel/shared';
import { api } from '../api';
import { formatDuration } from './common';

const boardLabel = (b: BoardId) => (b === 'overall' ? 'Overall' : MODES[b].label);

/** Today's daily ranking. `refreshKey` changes → reload (e.g. after finishing a run). */
export function Leaderboard({
  initial = 'overall',
  limit,
  refreshKey,
}: {
  initial?: BoardId;
  /** Show only the top N rows (plus your own) */
  limit?: number;
  refreshKey?: unknown;
}) {
  const [board, setBoard] = useState<BoardId>(initial);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setBoard(initial), [initial]);
  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .leaderboard(board)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [board, refreshKey]);

  const rows = data && data.board === board ? data.entries.slice(0, limit ?? data.entries.length) : null;
  const youOutside = data?.you && rows && !rows.some((r) => r.you) ? data.you : null;

  return (
    <section class="card board-card">
      <div class="board-head">
        <h2>Daily ranking</h2>
        {data && <span class="muted small">{data.date} · UTC</span>}
      </div>
      <div class="seg" role="tablist" aria-label="Leaderboard">
        {BOARD_IDS.map((b) => (
          <button key={b} role="tab" aria-selected={b === board} class={b === board ? 'on' : ''} onClick={() => setBoard(b)}>
            {boardLabel(b)}
          </button>
        ))}
      </div>
      {error && <p class="form-error">{error}</p>}
      {!rows && !error && <p class="muted center small">Loading…</p>}
      {rows && rows.length === 0 && <p class="muted center small">No finished runs yet today. Be the first!</p>}
      {rows && rows.length > 0 && (
        <table class="board">
          <tbody>
            {rows.map((e, i) => (
              <tr key={i} class={e.you ? 'you' : ''}>
                <td class={`rank r${e.rank}`}>{e.rank}</td>
                <td class="name">
                  {e.name}
                  {e.you && <span class="you-tag">you</span>}
                </td>
                <td class="time">{formatDuration(e.timeMs)}</td>
                <td class="score">{e.score}</td>
              </tr>
            ))}
            {youOutside && (
              <>
                <tr class="gap">
                  <td colSpan={4}>⋯</td>
                </tr>
                <tr class="you">
                  <td class="rank">{youOutside.rank}</td>
                  <td class="name">
                    {youOutside.name}
                    <span class="you-tag">you</span>
                  </td>
                  <td class="time">{formatDuration(youOutside.timeMs)}</td>
                  <td class="score">{youOutside.score}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      )}
      {data && data.players > 0 && (
        <p class="muted small center board-foot">
          {data.players} {data.players === 1 ? 'player' : 'players'} today
        </p>
      )}
    </section>
  );
}
