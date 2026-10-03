// "Find a game": public group games. Player counts stay private, so a quiet hour doesn't put anyone off.
import { GROUP_MAX_PLAYERS, QUICK_GAMES } from '@flagduel/shared';

/** The big "Find a game" card. */
export function QuickCard({ busy, onFind }: { busy: boolean; onFind: () => void }) {
  return (
    <section class="card home-card quick-find">
      <div class="qf-text">
        <h2>Play online</h2>
        <p class="muted small">
          Up to {GROUP_MAX_PLAYERS} players, {QUICK_GAMES} random games, everyone answers every round. Once a second
          player is in, there's a minute for more to join — then it starts.
        </p>
      </div>
      <button type="button" class="btn btn-primary btn-lg" disabled={busy} onClick={onFind}>
        Find a game
      </button>
    </section>
  );
}
