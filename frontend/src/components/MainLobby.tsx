import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  MODE_IDS,
  MODES,
  RANKED_MODE_IDS,
  type DailySummary,
  type MeResponse,
  type ModeId,
  type UserView,
} from '@flagduel/shared';
import { api } from '../api';
import { formatDuration } from './common';
import { NextDaily } from './Daily';
import { GameIcon, PracticeGlyph, type TileIcon } from './GameIcons';
import { GEO_KNOWLEDGE_LABEL, GEO_SPEED_LABEL, HIGHER_LABEL } from './Higher';
import { QuickCard } from './Quick';
import type { GameId, Tab } from './NavBar';

/** The lock-in games sit with Higher or Lower: one answer each, being right is what counts. */
const KNOWLEDGE_MODES: ModeId[] = MODE_IDS.filter((m) => !(RANKED_MODE_IDS as readonly ModeId[]).includes(m));

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
      {actions && <div class="gt-actions">{actions}</div>}
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

/** The start screen: "Find a game" (multiplayer), then every game's daily (the big tile) and practice. */
export function MainLobby({
  user,
  onNavigate,
  onQuick,
}: {
  user: UserView;
  onNavigate: (t: Tab, mode?: GameId | null) => void;
  /** Look for a public multiplayer game */
  onQuick: () => void;
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

      <QuickCard busy={false} onFind={onQuick} />

      <section class="game-group" aria-labelledby="g-speed">
        <div class="group-head">
          <h2 id="g-speed">{GEO_SPEED_LABEL}</h2>
          <span class="muted small">Answer fast — every second counts</span>
        </div>
        <div class="game-row">
          {RANKED_MODE_IDS.map((m) => {
            const info = today?.modes[m];
            return (
              <GameTile
                key={m}
                icon={m}
                name={MODES[m].label}
                status={info?.status ?? null}
                result={info ? `${info.score} pts${info.timeMs !== null ? ` · ${formatDuration(info.timeMs)}` : ''}` : ''}
                onDaily={() => onNavigate('daily', m)}
                actions={<TileButton icon={<PracticeGlyph />} label="Practice" onClick={() => onNavigate('practice', m)} />}
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
            actions={null}
          />
          {KNOWLEDGE_MODES.map((m) => {
            const info = today?.modes[m];
            return (
              <GameTile
                key={m}
                icon={m}
                name={MODES[m].label}
                status={info?.status ?? null}
                result={info ? `${info.score} pts${info.timeMs !== null ? ` · ${formatDuration(info.timeMs)}` : ''}` : ''}
                onDaily={() => onNavigate('daily', m)}
                actions={<TileButton icon={<PracticeGlyph />} label="Practice" onClick={() => onNavigate('practice', m)} />}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}
