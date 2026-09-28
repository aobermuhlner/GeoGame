import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { MODE_IDS, MODES, type DailySummary, type MeResponse, type ModeId, type UserView } from '@flagduel/shared';
import { api } from '../api';
import { formatDuration } from './common';
import { NextDaily } from './Daily';
import { DuelGlyph, GameIcon, PracticeGlyph, type TileIcon } from './GameIcons';
import { GEO_KNOWLEDGE_LABEL, GEO_SPEED_LABEL, HIGHER_LABEL } from './Higher';
import { storeRankedMode } from './Ranked';
import type { GameId, Tab } from './NavBar';

type Status = 'new' | 'playing' | 'finished';

/** A big tile: the card plays today's daily game, the buttons below open practice / a duel. */
function GameTile({
  icon,
  name,
  status,
  result,
  onDaily,
  actions,
}: {
  icon: TileIcon;
  name: string;
  status: Status | null;
  /** Today's result, shown once finished */
  result?: string;
  onDaily?: () => void;
  actions: ComponentChildren;
}) {
  const badge =
    status === 'finished' ? `✓ ${result}` : status === 'playing' ? 'Daily · in progress' : status ? 'Daily · play now' : '';
  const body = (
    <>
      <GameIcon id={icon} />
      <span class="gt-text">
        <span class="gt-name">{name}</span>
        {badge && <span class={`gt-badge ${status}`}>{badge}</span>}
      </span>
    </>
  );
  return (
    <div class={`game-tile t-${icon}`}>
      {onDaily ? (
        <button class="gt-main" onClick={onDaily} aria-label={`${name}: play today's daily game`}>
          {body}
        </button>
      ) : (
        <div class="gt-main">{body}</div>
      )}
      <div class="gt-actions">{actions}</div>
    </div>
  );
}

function TileButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentChildren;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button class="gt-btn" onClick={onClick} disabled={disabled}>
      {icon}
      {label}
    </button>
  );
}

/** The start screen: quick access to every game — daily (the big tile), practice and duels. */
export function MainLobby({
  user,
  onNavigate,
}: {
  user: UserView;
  onNavigate: (t: Tab, mode?: GameId | null) => void;
}) {
  const [today, setToday] = useState<DailySummary | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    api.dailySummary().then(setToday).catch(() => {});
    api.me().then(setMe).catch(() => {});
  }, [user.id]);

  const games = MODE_IDS.length + 1; // + Higher or Lower
  const doneToday = today
    ? MODE_IDS.filter((m) => today.modes[m].status === 'finished').length + (today.higher.status === 'finished' ? 1 : 0)
    : 0;
  const streak = me?.stats.streak ?? 0;

  function duel(m: ModeId) {
    storeRankedMode(m); // the ranked card opens on this game
    onNavigate('multi');
  }

  return (
    <main class="stack lobby">
      <header class="lobby-hello">
        <div>
          <h1>Hi, {user.displayName}!</h1>
          <p class="muted small">
            {!today
              ? 'Loading today’s games…'
              : doneToday === games
                ? 'All daily games done — see you tomorrow!'
                : `${doneToday} of ${games} daily games played today.`}
            {streak > 0 && <span class="streak-chip">🔥 {streak}-day streak</span>}
          </p>
        </div>
        {today && <NextDaily at={today.nextAt} />}
      </header>

      <section class="game-group" aria-labelledby="g-speed">
        <div class="group-head">
          <h2 id="g-speed">{GEO_SPEED_LABEL}</h2>
          <span class="muted small">Answer fast — every second counts</span>
        </div>
        <div class="game-row">
          {MODE_IDS.map((m) => {
            const info = today?.modes[m];
            return (
              <GameTile
                key={m}
                icon={m}
                name={MODES[m].label}
                status={info?.status ?? null}
                result={info ? `${info.score} pts${info.timeMs !== null ? ` · ${formatDuration(info.timeMs)}` : ''}` : ''}
                onDaily={() => onNavigate('daily', m)}
                actions={
                  <>
                    <TileButton icon={<PracticeGlyph />} label="Practice" onClick={() => onNavigate('practice', m)} />
                    <TileButton icon={<DuelGlyph />} label="Duel" onClick={() => duel(m)} />
                  </>
                }
              />
            );
          })}
        </div>
      </section>

      <section class="game-group" aria-labelledby="g-knowledge">
        <div class="group-head">
          <h2 id="g-knowledge">{GEO_KNOWLEDGE_LABEL}</h2>
          <span class="muted small">Take your time — only being right counts</span>
        </div>
        <div class="game-row">
          <GameTile
            icon="higher"
            name={HIGHER_LABEL}
            status={today?.higher.status ?? null}
            result={today ? `${today.higher.flawless} flawless` : ''}
            onDaily={() => onNavigate('daily', 'higher')}
            actions={<TileButton icon={<DuelGlyph />} label="Duel a friend" onClick={() => onNavigate('multi')} />}
          />
          <GameTile
            icon="soon"
            name="More coming soon"
            status={null}
            actions={<TileButton icon={null} label="New games on the way" disabled />}
          />
        </div>
      </section>
    </main>
  );
}
