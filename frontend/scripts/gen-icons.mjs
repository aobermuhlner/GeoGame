// Renders the PWA / Android icons in public/icons from the Logo (components/common.tsx).
// Run with `npm run gen:icons -w frontend` after changing the logo; the PNGs are committed.
// sharp comes from the workspace install (the worker depends on it).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const GREEN = '#1f4d2e';
const CREAM = '#fffdf7';
const GOLD = '#f2c14e';

/** The logo's globe lines, pole and flag, drawn in a 48×48 box centred on (24, 24). */
const mark = `
  <g fill="none" stroke="${CREAM}" stroke-opacity=".28" stroke-width="1.6">
    <ellipse cx="24" cy="24" rx="9" ry="21" />
    <path d="M3 24h42M6 14h36M6 34h36" />
  </g>
  <path d="M17 11v27" stroke="${CREAM}" stroke-width="3" stroke-linecap="round" />
  <path d="M18.5 12h15l-4 5.5 4 5.5h-15z" fill="${GOLD}" />`;

// "any": the round logo on a transparent background, as on the site.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="22" fill="${GREEN}" />${mark}</svg>`;

// "maskable": full-bleed green; the mark is scaled into the 80 % safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${GREEN}" />
  <g transform="translate(24 24) scale(.72) translate(-24 -24)">
    <circle cx="24" cy="24" r="22" fill="none" stroke="${CREAM}" stroke-opacity=".28" stroke-width="1.6" />${mark}
  </g></svg>`;

// "monochrome": only the alpha channel is used (Android themed icons): pole and flag.
const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="translate(24 24) scale(.8) translate(-25 -24.5)">
    <path d="M17 11v27" stroke="#fff" stroke-width="3" stroke-linecap="round" />
    <path d="M18.5 12h15l-4 5.5 4 5.5h-15z" fill="#fff" />
  </g></svg>`;

const icons = [
  ['icon-192.png', any, 192],
  ['icon-512.png', any, 512],
  ['maskable-192.png', maskable, 192],
  ['maskable-512.png', maskable, 512],
  ['monochrome-512.png', monochrome, 512],
  ['apple-touch-icon.png', maskable, 180],
];

await mkdir(out, { recursive: true });
for (const [name, svg, size] of icons) {
  await sharp(Buffer.from(svg), { density: (72 * size) / 48 })
    .resize(size, size)
    .png()
    .toFile(join(out, name));
  console.log(`icons/${name}`);
}
