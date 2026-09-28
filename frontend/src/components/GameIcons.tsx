import type { ComponentChildren, JSX } from 'preact';
import type { GameId } from './NavBar';

/** Illustrations of the lobby's game tiles: tilted white cards, drawn in the tile's own ink. */

const INK = '#2b2b2b';

/** A white card with a soft shadow, rotated by `rot` degrees around its centre. */
function Card({
  x,
  y,
  w,
  h,
  rot = 0,
  fill = '#fff',
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  fill?: string;
  children?: ComponentChildren;
}) {
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      <rect x={x} y={y + 4} width={w} height={h} rx="11" fill="rgba(0,0,0,.14)" />
      <rect x={x} y={y} width={w} height={h} rx="11" fill={fill} />
      {children}
    </g>
  );
}

function FlagsIcon() {
  return (
    <>
      <Card x={18} y={14} w={58} h={48} rot={-10}>
        <rect x="27" y="26" width="40" height="5" rx="2.5" fill="#e3e3e3" />
        <rect x="27" y="36" width="30" height="5" rx="2.5" fill="#e3e3e3" />
        <rect x="27" y="46" width="34" height="5" rx="2.5" fill="#e3e3e3" />
      </Card>
      <Card x={44} y={20} w={60} h={50} rot={7}>
        <rect x="53" y="30" width="14" height="30" rx="2" fill="#2d6cdf" />
        <rect x="67" y="30" width="14" height="30" fill="#f4f4f4" />
        <rect x="81" y="30" width="14" height="30" rx="2" fill="#e04848" />
        <rect x="53" y="30" width="42" height="30" rx="2" fill="none" stroke="#d9d9d9" stroke-width="1.5" />
      </Card>
    </>
  );
}

function CapitalsIcon() {
  return (
    <>
      <Card x={30} y={16} w={62} h={56} rot={-6}>
        {/* dome, drum, columns, steps */}
        <path d="M61 23v5" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
        <path d="M49 40a12 12 0 0 1 24 0z" fill={INK} />
        <rect x="46" y="40" width="30" height="4" rx="1.5" fill={INK} />
        {[49, 56, 63, 70].map((cx) => (
          <rect key={cx} x={cx} y="46" width="3.4" height="12" rx="1" fill={INK} />
        ))}
        <rect x="43" y="59" width="36" height="4" rx="1.5" fill={INK} />
      </Card>
      {/* star pin */}
      <g transform="translate(88 18)">
        <circle r="13" fill="#e04848" />
        <path
          d="M0-7l2.1 4.3 4.7.7-3.4 3.3.8 4.7L0 3.8-4.2 6l.8-4.7L-6.8-2l4.7-.7z"
          fill="#fff"
        />
      </g>
    </>
  );
}

function LocateIcon() {
  return (
    <>
      <Card x={20} y={18} w={76} h={52} rot={-5} fill="#dff1ff">
        {/* grid + landmasses */}
        <path d="M20 36h76M20 52h76M45 18v52M70 18v52" stroke="#bcdcf5" stroke-width="1.5" />
        <path
          d="M28 30c6-5 14-4 18 1s-1 9 3 13-4 9-9 7-4-8-9-10-7-7-3-11z"
          fill="#86c26a"
        />
        <path d="M62 44c5-6 15-7 21-2s3 12-3 14-9-2-13 0-9-6-5-12z" fill="#86c26a" />
      </Card>
      {/* map pin */}
      <g transform="translate(74 10)">
        <path d="M0 0c-10 0-17 7-17 16 0 11 17 28 17 28s17-17 17-28C17 7 10 0 0 0z" fill="rgba(0,0,0,.16)" transform="translate(0 4)" />
        <path d="M0 0c-10 0-17 7-17 16 0 11 17 28 17 28s17-17 17-28C17 7 10 0 0 0z" fill="#e04848" />
        <circle cy="16" r="6.5" fill="#fff" />
      </g>
    </>
  );
}

function HigherIcon() {
  return (
    <>
      <Card x={20} y={10} w={50} h={42} rot={-8} fill="#7cc653">
        <path d="M35 36l10-10 10 10" fill="none" stroke={INK} stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      </Card>
      <Card x={50} y={32} w={54} h={42} rot={-4}>
        <path d="M67 48l10 10 10-10" fill="none" stroke={INK} stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      </Card>
    </>
  );
}

function SoonIcon() {
  return (
    <>
      <Card x={22} y={12} w={46} h={50} rot={-8}>
        {/* light bulb */}
        <path d="M45 22a11 11 0 0 0-6.5 19.8V46h13v-4.2A11 11 0 0 0 45 22z" fill="#f7c948" />
        <rect x="39" y="48" width="12" height="3.5" rx="1.75" fill="#9aa4ad" />
        <rect x="40.5" y="53.5" width="9" height="3.5" rx="1.75" fill="#9aa4ad" />
      </Card>
      <Card x={52} y={26} w={48} h={50} rot={6}>
        <text x="76" y="63" text-anchor="middle" font-family="Lexend, system-ui, sans-serif" font-size="32" font-weight="600" fill={INK}>
          ?
        </text>
      </Card>
    </>
  );
}

export type TileIcon = GameId | 'soon';

const ICONS: Record<TileIcon, () => JSX.Element> = {
  flags: FlagsIcon,
  capitals: CapitalsIcon,
  locate: LocateIcon,
  higher: HigherIcon,
  soon: SoonIcon,
};

export function GameIcon({ id }: { id: TileIcon }) {
  const Icon = ICONS[id];
  return (
    <svg class="gt-icon" viewBox="0 0 120 84" aria-hidden="true">
      <Icon />
    </svg>
  );
}

/** Small line icons for the tile buttons. */
export function PracticeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function DuelGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6M16 16l4 4M19 21l2-2" />
      <path d="M14.5 6.5L18 3h3v3l-3.5 3.5" />
      <path d="M5 14l4 4M7 17l-3 3M3 19l2 2" />
    </svg>
  );
}
