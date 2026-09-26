// Generates the ranked division emblems: two crossed flags in the division's metal, on a medallion that
// gains ornaments as the division rises (Silver: double ring, Gold: laurel, Platinum: stars, Diamond: gem + rays).
// Output: src/assets/emblems/<division>.svg (ids are prefixed per division so several can be inlined on one page).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/emblems');

// hi → mid → lo → deep, light to dark
const PALETTES = {
  bronze: { hi: '#f7d2ae', mid: '#c9804a', lo: '#8a4b1c', deep: '#4a250c', level: 0 },
  silver: { hi: '#ffffff', mid: '#c3ccd5', lo: '#76818c', deep: '#343d46', level: 1 },
  gold: { hi: '#fff6c2', mid: '#f2c14e', lo: '#b7860b', deep: '#5a3f00', level: 2 },
  platinum: { hi: '#ecfffb', mid: '#9fe0d6', lo: '#3a9d8f', deep: '#134a42', level: 3 },
  diamond: { hi: '#f2f7ff', mid: '#a4bcff', lo: '#3d5fd6', deep: '#18266e', level: 4 },
};

const r1 = (n) => Math.round(n * 10) / 10;

function star(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    pts.push(`${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/** Laurel leaves along the lower part of the ring, one branch per side. */
function laurel(id) {
  const leaves = [];
  const stems = [];
  const cx = 64, cy = 64, R = 57.5;
  const leaf = 'M0,0 C3.2,-2.5 3.2,-7.5 0,-11 C-3.2,-7.5 -3.2,-2.5 0,0 Z';
  for (const side of [-1, 1]) {
    const pt = (deg, r) => {
      const a = ((90 + side * deg) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const [sx, sy] = pt(12, R);
    const [ex, ey] = pt(118, R);
    // the right branch climbs clockwise (sweep 1), the left one counter-clockwise
    stems.push(`M${r1(sx)},${r1(sy)} A${R},${R} 0 0 ${side > 0 ? 1 : 0} ${r1(ex)},${r1(ey)}`);
    for (let i = 0; i < 9; i++) {
      // degrees from straight down, climbing the side; leaves alternate outside / inside the stem
      const deg = 16 + i * 12;
      const out = i % 2 === 0;
      const [x, y] = pt(deg, R);
      // "up the arc" direction, then tilted away from the stem
      const tangent = 90 + side * deg + side * 90 + 90;
      const tilt = (out ? 1 : -1) * side * 38;
      leaves.push(`<path d="${leaf}" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(tangent + tilt)})"/>`);
    }
  }
  return `<g fill="none" stroke="url(#${id}-edge)" stroke-width="1.4" stroke-linecap="round"><path d="${stems.join(' ')}"/></g>
  <g fill="url(#${id}-metal)" stroke="url(#${id}-edge)" stroke-width="0.7" stroke-linejoin="round">${leaves.join('')}</g>`;
}

/**
 * One flag in local coordinates: pole base at the origin, pole up the -y axis, cloth flying to the left.
 * `stripe` picks the cloth design so the two flags differ.
 */
function flag(id, transform, stripe) {
  const cloth = 'M0,-80 C-10,-86 -22,-73 -40,-80 L-40,-52 C-22,-45 -10,-58 0,-52 Z';
  const design =
    stripe === 'band'
      ? '<path d="M0,-70 C-10,-76 -22,-63 -40,-70 L-40,-62 C-22,-55 -10,-68 0,-62 Z" fill="url(#' +
        id +
        '-dark)"/>'
      : `<polygon points="${star(-20, -66.5, 7, 3)}" fill="url(#${id}-dark)"/>`;
  return `<g transform="${transform}">
    <rect x="-2.3" y="-86" width="4.6" height="88" rx="2" fill="url(#${id}-pole)" stroke="${'url(#' + id + '-edge)'}" stroke-width="0.8"/>
    <path d="${cloth}" fill="url(#${id}-cloth)" stroke="url(#${id}-edge)" stroke-width="1.4" stroke-linejoin="round"/>
    ${design}
    <path d="${cloth}" fill="url(#${id}-fold)"/>
    <circle cy="-89" r="4.2" fill="url(#${id}-knob)" stroke="url(#${id}-edge)" stroke-width="0.8"/>
  </g>`;
}

function emblem(name, p) {
  const id = `em-${name}`;
  const L = p.level;
  const defs = `<defs>
    <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.hi}"/><stop offset=".45" stop-color="${p.mid}"/>
      <stop offset=".7" stop-color="${p.lo}"/><stop offset="1" stop-color="${p.mid}"/>
    </linearGradient>
    <linearGradient id="${id}-cloth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.hi}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.lo}"/>
    </linearGradient>
    <linearGradient id="${id}-dark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.lo}"/><stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
    <linearGradient id="${id}-pole" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.lo}"/><stop offset=".4" stop-color="${p.hi}"/><stop offset="1" stop-color="${p.lo}"/>
    </linearGradient>
    <linearGradient id="${id}-edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.lo}"/><stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
    <linearGradient id="${id}-fold" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".22" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".5" stop-color="#000" stop-opacity=".16"/><stop offset=".78" stop-color="#fff" stop-opacity=".24"/>
      <stop offset="1" stop-color="#000" stop-opacity=".14"/>
    </linearGradient>
    <radialGradient id="${id}-knob" cx=".35" cy=".35" r=".7">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${p.hi}"/><stop offset="1" stop-color="${p.lo}"/>
    </radialGradient>
    <radialGradient id="${id}-plate" cx=".5" cy=".38" r=".65">
      <stop offset="0" stop-color="${p.lo}"/><stop offset="1" stop-color="${p.deep}"/>
    </radialGradient>
    <radialGradient id="${id}-glow" gradientUnits="userSpaceOnUse" cx="64" cy="64" r="64">
      <stop offset=".75" stop-color="${p.mid}" stop-opacity="1"/><stop offset="1" stop-color="${p.mid}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

  const parts = [];

  // Diamond: light rays behind the medallion, long and short alternating
  if (L >= 4) {
    const rays = [];
    for (let i = 0; i < 24; i++) {
      const tip = i % 2 ? 6 : 0;
      rays.push(`<polygon points="64,64 61.5,${tip} 66.5,${tip}" transform="rotate(${(i * 360) / 24 + 7.5} 64 64)"/>`);
    }
    parts.push(`<g fill="url(#${id}-glow)">${rays.join('')}</g>`);
  }

  // Medallion
  parts.push(`<circle cx="64" cy="64" r="50" fill="url(#${id}-plate)" stroke="url(#${id}-metal)" stroke-width="6"/>`);
  parts.push(`<circle cx="64" cy="64" r="45.5" fill="none" stroke="${p.hi}" stroke-opacity=".35" stroke-width="1"/>`);
  if (L >= 1) parts.push(`<circle cx="64" cy="64" r="55" fill="none" stroke="url(#${id}-metal)" stroke-width="2"/>`);

  // Gold+: laurel around the bottom
  if (L >= 2) parts.push(laurel(id));

  // Crossed flags; the second mirrors the first so both fly outward
  const pose = 'translate(88 110) rotate(-26) scale(1.14)';
  parts.push(flag(id, pose, 'band'));
  parts.push(`<g transform="translate(128 0) scale(-1 1)">${flag(id, pose, 'star')}</g>`);

  // Platinum+: stars above the flags; Diamond swaps the middle one for a gem
  if (L >= 3) {
    const s = (x, y, o) =>
      `<polygon points="${star(x, y, o, o * 0.45)}" fill="url(#${id}-metal)" stroke="url(#${id}-edge)" stroke-width="0.8" stroke-linejoin="round"/>`;
    // side stars sit between the pole knobs and the centre piece
    if (L < 4) parts.push(s(55, 17, 3.4), s(73, 17, 3.4), s(64, 13, 6));
  }
  if (L >= 4) {
    // four-point sparkles in the free corners
    const spark = (x, y, r) =>
      `<path d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r} Z" fill="${p.hi}" stroke="${p.lo}" stroke-width=".5"/>`;
    parts.push(spark(14, 16, 7), spark(114, 20, 5), spark(22, 30, 3.5));
    parts.push(`<g stroke="${p.deep}" stroke-width="0.8" stroke-linejoin="round">
      <polygon points="54,14 58,8 70,8 74,14 64,28" fill="${p.mid}"/>
      <polygon points="58,8 70,8 67,14 61,14" fill="${p.hi}"/>
      <polygon points="54,14 61,14 64,28" fill="${p.lo}"/>
      <polygon points="74,14 67,14 64,28" fill="${p.mid}"/>
      <polygon points="61,14 67,14 64,28" fill="${p.hi}" fill-opacity=".7"/>
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${name[0].toUpperCase() + name.slice(1)} division">
  ${defs}
  ${parts.join('\n  ')}
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, p] of Object.entries(PALETTES)) {
  writeFileSync(join(OUT, `${name}.svg`), emblem(name, p));
}
console.log(`wrote ${Object.keys(PALETTES).length} emblems to ${OUT}`);
