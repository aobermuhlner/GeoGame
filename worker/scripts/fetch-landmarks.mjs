// Downloads the Landmarks game's photos and writes their coordinates + credits. Run by hand after
// editing shared/src/landmarks.ts:   node worker/scripts/fetch-landmarks.mjs [--force] [id ...]
//
// For each landmark: the English Wikipedia article gives the coordinates and (unless the list names a
// Commons `file`) the lead photo. Only freely licensed Wikimedia Commons files are accepted. Each photo is
// fitted into a 1600×1200 canvas (4:3, the game's frame) over a blurred copy of itself, so portrait shots
// keep their full height. Output (both checked in):
//   worker/landmarks/<id>.jpg      served only through per-round tokens (Workers static assets, never public)
//   shared/src/landmarkMeta.ts     coordinates for the reveal map + credits for the credits page
// Photos that already exist are kept unless --force (or their id is given).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(here, '../landmarks');
const META = join(here, '../../shared/src/landmarkMeta.ts');
const UA = 'FlagDuel-GeoGame/1.0 (https://github.com/aobermuhlner/GeoGame; build script)';
const W = 1600;
const H = 1200;

const { LANDMARKS } = await import(pathToFileURL(join(here, '../../shared/src/landmarks.ts')).href);
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));

// Articles without coordinates in their page data.
const MANUAL_COORDS = {
  kinderdijk: [51.884, 4.639],
  dubrovnik: [42.641, 18.11],
  'stari-most': [43.3373, 17.815],
  petra: [30.3285, 35.4444],
  kilimanjaro: [-3.0674, 37.3556],
  moai: [-27.1258, -109.2767],
  'twelve-apostles': [-38.665, 143.105],
  'grand-canal-venice': [45.4375, 12.3358],
  'blyde-river-canyon': [-24.58, 30.8],
};

const FREE = /^(cc[ -]by|cc[ -]by-sa|cc0|public domain|pd\b|pd-|attribution|gfdl|fal\b|free art|kogl type 1|no restrictions)/i;

async function api(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const strip = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Article → { lat, lon, image } (image = lead photo file name without "File:") */
async function articles(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const j = await api('en.wikipedia.org', {
      action: 'query',
      prop: 'pageimages|coordinates',
      colimit: 'max',
      piprop: 'name',
      redirects: '1',
      titles: batch.join('|'),
    });
    const alias = new Map();
    for (const n of j.query.normalized ?? []) alias.set(n.to, n.from);
    for (const r of j.query.redirects ?? []) alias.set(r.to, alias.get(r.from) ?? r.from);
    for (const p of j.query.pages) {
      const title = alias.get(p.title) ?? p.title;
      const c = p.coordinates?.[0];
      out.set(title, { lat: c?.lat ?? null, lon: c?.lon ?? null, image: p.pageimage ?? null, missing: !!p.missing });
    }
  }
  return out;
}

async function commonsInfo(file) {
  const j = await api('commons.wikimedia.org', {
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920',
    titles: `File:${file}`,
  });
  const p = j.query.pages[0];
  const ii = p?.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata ?? {};
  return {
    thumb: ii.thumburl ?? ii.url,
    width: ii.width,
    height: ii.height,
    author: strip(m.Artist?.value) || 'Unknown author',
    license: strip(m.LicenseShortName?.value) || 'unknown',
    licenseUrl: strip(m.LicenseUrl?.value) || null,
    source: ii.descriptionurl,
  };
}

async function download(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
}

/** Fit into W×H over a blurred, darkened cover copy of the same photo. */
async function toFrame(buf) {
  const bg = await sharp(buf).rotate().resize(W / 8, H / 8, { fit: 'cover' }).blur(6).modulate({ brightness: 0.7 }).resize(W, H).toBuffer();
  const fg = await sharp(buf).rotate().resize(W, H, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
  return sharp(bg)
    .composite([{ input: fg.data, left: Math.round((W - fg.info.width) / 2), top: Math.round((H - fg.info.height) / 2) }])
    .jpeg({ quality: 78, mozjpeg: true, progressive: true })
    .toBuffer();
}

const oldMeta = existsSync(META)
  ? JSON.parse(readFileSync(META, 'utf8').match(/= (\{[\s\S]*\});\s*$/)?.[1] ?? '{}')
  : {};
mkdirSync(IMG_DIR, { recursive: true });

const info = await articles([...new Set(LANDMARKS.map((l) => l.wiki))]);
const meta = {};
const problems = [];
for (const l of LANDMARKS) {
  const a = info.get(l.wiki);
  if (!a || a.missing) {
    problems.push(`${l.id}: no article "${l.wiki}"`);
    continue;
  }
  const file = l.file ?? a.image;
  if (!file) {
    problems.push(`${l.id}: article has no lead image — set \`file\``);
    continue;
  }
  const out = join(IMG_DIR, `${l.id}.jpg`);
  const prev = oldMeta[l.id];
  const redo = force || only.has(l.id) || !existsSync(out) || prev?.file !== file;
  if (only.size && !only.has(l.id) && prev) {
    meta[l.id] = prev;
    continue;
  }
  const c = redo || !prev ? await commonsInfo(file) : prev;
  if (!c) {
    problems.push(`${l.id}: "${file}" is not on Commons (local/non-free?) — set \`file\``);
    continue;
  }
  if (!FREE.test(c.license)) {
    problems.push(`${l.id}: "${file}" has license "${c.license}" — set \`file\``);
    continue;
  }
  if (redo) {
    const buf = await toFrame(await download(c.thumb));
    writeFileSync(out, buf);
    console.log(`${l.id}: ${file} (${Math.round(buf.length / 1024)} KB, ${c.license})`);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (a.lat === null && MANUAL_COORDS[l.id]) [a.lat, a.lon] = MANUAL_COORDS[l.id];
  meta[l.id] = {
    lat: a.lat === null ? null : Math.round(a.lat * 1e4) / 1e4,
    lon: a.lon === null ? null : Math.round(a.lon * 1e4) / 1e4,
    file,
    author: c.author,
    license: c.license,
    licenseUrl: c.licenseUrl,
    source: c.source,
  };
  if (a.lat === null) problems.push(`${l.id}: article has no coordinates (the reveal map only highlights the country)`);
}

writeFileSync(
  META,
  `// Generated by worker/scripts/fetch-landmarks.mjs — do not edit (edit landmarks.ts and re-run).\n` +
    `export interface LandmarkMeta {\n  lat: number | null;\n  lon: number | null;\n  /** Wikimedia Commons file */\n  file: string;\n  author: string;\n  license: string;\n  licenseUrl: string | null;\n  /** Commons file page */\n  source: string;\n}\n\n` +
    `export const LANDMARK_META: Record<string, LandmarkMeta> = ${JSON.stringify(meta, null, 2)};\n`,
);
console.log(`\n${Object.keys(meta).length}/${LANDMARKS.length} landmarks ok`);
if (problems.length) console.log('\nProblems:\n' + problems.map((p) => '  ' + p).join('\n'));
