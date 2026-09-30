// Pre-renders the GeoLocate world map (src/generated/locatemap.ts): one SVG path per playable country
// from Natural Earth 50m, plus click helpers for places too small to hit:
//   - markers: a dot per island cluster / microstate (drawn at a constant on-screen size)
//   - zones:   a padded hull around each island group (Kiribati, Marshall Islands, Bahamas, …)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const iso = require('i18n-iso-countries');
const here = dirname(fileURLToPath(import.meta.url));

// Playable codes = every code in the region table.
const regionsSrc = readFileSync(join(here, '../../shared/src/regions.ts'), 'utf8');
const table = /const TABLE[^{]*\{([\s\S]*?)\n\};/.exec(regionsSrc)[1];
const PLAYABLE = new Set([...table.matchAll(/'([A-Z ]{2,})'/g)].flatMap((m) => m[1].split(/\s+/)));

const BY_NAME = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };
const alpha2 = (f) => BY_NAME[f.properties.name] ?? iso.numericToAlpha2(f.id);
// Missing from the dataset: atolls as points.
const MANUAL_POINTS = {
  TV: [
    [179.2, -8.52],
    [176.12, -5.68],
    [177.34, -6.29],
    [176.3, -7.49],
    [178.68, -7.22],
    [179.1, -9.01],
    [179.47, -10.78],
  ],
};

const WIDTH = 2000;
const SMALL_AREA = 30; // px² at WIDTH: below this a country gets a marker
const GROUP_GAP = 34; // px: island polygons closer than this form one cluster
const ZONE_PAD = 7; // px around an island cluster
const ARCHIPELAGO_AREA = 700; // px²: island nations up to this size whose islands are spread out get zones
const MIN_ZONE = 14; // px: clusters narrower than this get a marker only, no dashed zone

const w50 = require('world-atlas/countries-50m.json');
const all = feature(w50, w50.objects.countries).features.filter((f) => f.id !== '010'); // no Antarctica

// Seam at 169°W (Bering Strait): keeps Fiji, Tonga, Samoa, Tuvalu and western Kiribati on one side.
const projection = geoNaturalEarth1().rotate([-11, 0]).fitWidth(WIDTH, { type: 'FeatureCollection', features: all });
const path = geoPath(projection).digits(1);
const [[, y0], [, y1]] = path.bounds({ type: 'FeatureCollection', features: all });
projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 6]);
const HEIGHT = Math.ceil(y1 - y0 + 12);

const r1 = (n) => Math.round(n * 10) / 10;
const SIMPLIFY = 0.18; // px: Douglas–Peucker tolerance (the map is shown up to ~30× zoom)

function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const dist =
        len === 1 && bx === ax && by === ay
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
          : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (dist > best) ((best = dist), (bi = i));
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts.slice(0, 3);
}

const num = (n) => {
  const s = (Math.round(n * 10) / 10).toString();
  return s.replace(/^(-?)0\./, '$1.');
};

/** Compact SVG path: simplified rings, relative coordinates, 0.1 px precision. */
function compactPath(features) {
  const rings = [];
  let ring = null;
  const ctx = {
    moveTo: (x, y) => rings.push((ring = [[x, y]])),
    lineTo: (x, y) => ring.push([x, y]),
    closePath() {},
    arc() {},
  };
  const draw = geoPath(projection, ctx);
  for (const f of features) draw(f);
  let d = '';
  for (const r of rings) {
    const pts = simplify(r, SIMPLIFY).map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
    let seg = '';
    let [px, py] = pts[0];
    for (const [x, y] of pts.slice(1)) {
      if (x === px && y === py) continue;
      const dx = num((x - px) / 10);
      const dy = num((y - py) / 10);
      seg += (dx.startsWith('-') ? '' : ' ') + dx + (dy.startsWith('-') ? '' : ' ') + dy;
      px = x;
      py = y;
    }
    d += `M${num(pts[0][0] / 10)} ${num(pts[0][1] / 10)}${seg ? 'l' + seg.replace(/^ /, '') : ''}z`;
  }
  return d;
}

// Group features by code (Somaliland → SO, N. Cyprus → CY).
const byCode = new Map();
const otherFeatures = [];
for (const f of all) {
  const code = alpha2(f);
  if (!PLAYABLE.has(code)) {
    otherFeatures.push(f);
    continue;
  }
  if (!byCode.has(code)) byCode.set(code, []);
  byCode.get(code).push(f);
}
const other = compactPath(otherFeatures);

/** Projected outer rings (as point lists) of a set of features, split at the antimeridian. */
function projectedPolygons(features) {
  const polys = [];
  let ring = [];
  const s = projection.stream({
    point: (x, y) => ring.push([x, y]),
    lineStart: () => (ring = []),
    lineEnd: () => ring.length > 2 && polys.push(ring),
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  });
  for (const f of features) {
    const g = f.geometry;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      // Outer ring only; holes don't matter for hulls and boxes.
      s.polygonStart();
      s.lineStart();
      for (const [lon, lat] of poly[0].slice(0, -1)) s.point(lon, lat);
      s.lineEnd();
      s.polygonEnd();
    }
  }
  return polys;
}

function bbox(points) {
  let [ax, ay, bx, by] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    ax = Math.min(ax, x);
    ay = Math.min(ay, y);
    bx = Math.max(bx, x);
    by = Math.max(by, y);
  }
  return [ax, ay, bx, by];
}

const gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

function cluster(polys) {
  const boxes = polys.map(bbox);
  const parent = polys.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < polys.length; i++)
    for (let j = i + 1; j < polys.length; j++) if (gap(boxes[i], boxes[j]) < GROUP_GAP) parent[find(i)] = find(j);
  const groups = new Map();
  polys.forEach((p, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(...p);
  });
  return [...groups.values()];
}

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function paddedHull(points, pad) {
  const base = hull(points);
  const ring = [];
  for (const [x, y] of base)
    for (let a = 0; a < 16; a++)
      ring.push([x + pad * Math.cos((a * Math.PI) / 8), y + pad * Math.sin((a * Math.PI) / 8)]);
  return hull(ring);
}

function hullArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const hullPath = (pts) => 'M' + pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L') + 'Z';

const countries = [];
let markerCount = 0;
let zoneCount = 0;
for (const code of PLAYABLE) {
  const features = byCode.get(code) ?? [];
  const d = compactPath(features);
  const area = features.reduce((s, f) => s + path.area(f), 0);
  let polys = projectedPolygons(features);
  if (MANUAL_POINTS[code]) polys = MANUAL_POINTS[code].map((ll) => [projection(ll)]);
  if (!polys.length) throw new Error(`No shape for ${code}`);

  const entry = { c: code, d, b: bbox(polys.flat()).map(r1) };
  const spread = hullArea(paddedHull(polys.flat(), 0));
  const largest =
    Math.max(...polys.map(hullArea)) /
    Math.max(
      1e-9,
      polys.reduce((t, p) => t + hullArea(p), 0),
    );
  const archipelago = area < ARCHIPELAGO_AREA && spread > 5 * area && largest < 0.65;
  if (area < SMALL_AREA || archipelago) {
    const groups = cluster(polys);
    entry.m = [];
    entry.z = [];
    for (const g of groups) {
      const [ax, ay, bx, by] = bbox(g);
      entry.m.push([r1((ax + bx) / 2), r1((ay + by) / 2)]);
      if (Math.max(bx - ax, by - ay) >= MIN_ZONE || groups.length > 1) entry.z.push(hullPath(paddedHull(g, ZONE_PAD)));
    }
    markerCount += entry.m.length;
    zoneCount += entry.z.length;
    if (!entry.z.length) delete entry.z;
  }
  countries.push(entry);
}

// Starting view when a match uses a single region: [west, south, east, north] in degrees.
// Hand-picked, since outliers (Russia, French Guiana, the Azores, …) would stretch computed bounds.
// Longitudes past 180 continue east over the seam's right-hand side (Oceania reaches Samoa at 188 = 172°W).
const REGION_VIEWS = {
  europe: [-25, 34, 45, 71],
  asia: [25, -11, 148, 55],
  africa: [-26, -36, 58, 38],
  oceania: [110, -48, 190, 20],
  'north-america': [-168, 13, -52, 73],
  'central-america': [-93, 7, -77, 19],
  caribbean: [-86, 10, -59, 27.5],
  'south-america': [-82, -56, -34, 13],
};
const views = {};
for (const [region, [w, s, e, n]] of Object.entries(REGION_VIEWS)) {
  // Sample the box edges: meridians and parallels are curved in Natural Earth.
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const lon = w + ((e - w) * i) / 20;
    const lat = s + ((n - s) * i) / 20;
    pts.push([lon, s], [lon, n], [w, lat], [e, lat]);
  }
  const wrap = (lon) => (lon > 180 ? lon - 360 : lon);
  views[region] = bbox(pts.map(([lon, lat]) => projection([wrap(lon), lat]))).map(r1);
}

// Landmarks game: where each landmark is, for the pin on the reveal map.
const { LANDMARK_META } = await import(pathToFileURL(join(here, '../../shared/src/landmarkMeta.ts')).href);
const pins = {};
for (const [id, m] of Object.entries(LANDMARK_META)) if (m.lat !== null) pins[id] = projection([m.lon, m.lat]).map(r1);

// Landmarks game: lets the browser turn a click into lat/lon and draw the pin's circle (shared/src/pin.ts).
const [tx, ty] = projection.translate();
const proj = { k: projection.scale(), tx, ty, rot: projection.rotate()[0] };

const out = { width: WIDTH, height: HEIGHT, other, countries, views, pins, proj };
mkdirSync(join(here, '../src/generated'), { recursive: true });
writeFileSync(
  join(here, '../src/generated/locatemap.ts'),
  `// Generated by scripts/gen-locate-map.mjs — do not edit.\n` +
    `import type { MapProjection, RegionId } from '@flagduel/shared';\n\n` +
    `export interface LocateCountry {\n  /** ISO alpha-2 */\n  c: string;\n  /** SVG path */\n  d: string;\n` +
    `  /** Bounding box [x0, y0, x1, y1] */\n  b: [number, number, number, number];\n` +
    `  /** Click markers (one per island cluster) for places too small to hit */\n  m?: [number, number][];\n` +
    `  /** Island-group zones (SVG paths) that count as a hit */\n  z?: string[];\n}\n\n` +
    `export const LOCATE_MAP: {\n  width: number;\n  height: number;\n  other: string;\n  countries: LocateCountry[];\n` +
    `  /** Starting view [x0, y0, x1, y1] for a match that uses only this region */\n` +
    `  views: Record<RegionId, [number, number, number, number]>;\n` +
    `  /** Landmark id → its position on the map */\n  pins: Record<string, [number, number]>;\n` +
    `  /** The projection, for the Landmarks pin (shared/src/pin.ts) */\n  proj: MapProjection;\n} = ` +
    `${JSON.stringify(out)};\n`,
);
const size = JSON.stringify(out).length;
console.log(
  `gen-locate-map: ${countries.length} countries, ${markerCount} markers, ${zoneCount} zones, ${(size / 1024).toFixed(0)} KB`,
);
