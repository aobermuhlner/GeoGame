// Downloads the Languages game's sentences from Tatoeba and writes shared/src/sentencesData.ts (checked in).
// Run by hand after editing shared/src/languages.ts:   node shared/scripts/fetch-sentences.mjs [id ...]
//
// Per language: random native sentences that have a direct English translation, 20–90 characters, no digits,
// no Latin-script names in non-Latin scripts beyond "Tom"/"Mary" style names (those are fine: Tatoeba uses
// them everywhere). Stored sentences are kept at their index (round items are "<id>.<index>") and each
// language is topped up to PER_LANGUAGE; languages whose ids are given are topped up, the others left as is
// (no ids: all of them). The picks are kept varied: few Tom/Mary sentences, no two that start alike or share
// most of their words, and a spread of lengths.
// Tatoeba content is CC BY 2.0 FR: each sentence keeps its id so the credits page can link to it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../src/sentencesData.ts');
const PER_LANGUAGE = 48;
const ROUNDS = 12;
const UA = 'FlagDuel-GeoGame/1.0 (build script)';

const { LANGUAGES } = await import(pathToFileURL(join(here, '../src/languages.ts')).href);
const only = new Set(process.argv.slice(2));
const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8').match(/= (\{[\s\S]*\});\s*$/)?.[1] ?? '{}') : {};

async function page(lang) {
  const url = `https://api.tatoeba.org/unstable/sentences?lang=${lang}&trans:lang=eng&trans:is_direct=yes&sort=random&limit=100`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return (await res.json()).data;
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean);
const isCjk = (s) => /[぀-ヿ一-鿿]/.test(s);
// Tokens for overlap checks: words, or character pairs for scripts written without spaces.
const tokens = (s) => {
  if (!isCjk(s) && !/[฀-๿]/.test(s)) return words(s);
  const c = [...fold(s).replace(/[\p{P}\s]/gu, '')];
  return c.slice(1).map((ch, i) => c[i] + ch);
};
const overlap = (a, b) => {
  const A = new Set(a), B = new Set(b);
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.max(1, Math.min(A.size, B.size));
};
const STOCK_NAMES = /\b(Tom|Mary|John|Ken|Tony|Jim|Bill|Mike|Jack|Lucy|Emi|Taro|Hanako|Sami|Layla|Ziri|Rima|Yanni|Skura|Dan|Linda)\b/;

/** Why `cand` would make the set less varied, or null if it is fine. */
function repetitive(cand, picked) {
  const en = cand.en;
  if (STOCK_NAMES.test(en) && picked.filter((p) => STOCK_NAMES.test(p.en)).length >= picked.length * 0.2) return 'names';
  const enW = words(en);
  // English opening: at most two sentences per two-word start ("I don't …", "Do you …").
  const start = enW.slice(0, 2).join(' ');
  if (picked.filter((p) => words(p.en).slice(0, 2).join(' ') === start).length >= 2) return 'start';
  // Native opening: no two sentences that open with the same three words (or six characters).
  const head = (t) => (isCjk(t) ? fold(t).slice(0, 6) : words(t).slice(0, 3).join(' '));
  if (picked.some((p) => head(p.text) === head(cand.text))) return 'head';
  const tc = tokens(cand.text);
  if (picked.some((p) => overlap(tokens(p.text), tc) > 0.6 || overlap(words(p.en), enW) > 0.7)) return 'similar';
  // Lengths: thirds of the allowed range, none of them taking more than half the set.
  const band = (p) => p.lenBand;
  if (picked.length >= 6 && picked.filter((p) => band(p) === cand.lenBand).length > picked.length / 2) return 'length';
  return null;
}

const out = {};
const problems = [];
for (const l of LANGUAGES) {
  const kept = (old[l.id] ?? []).map((s) => ({ ...s }));
  if ((only.size && !only.has(l.id) && kept.length) || kept.length >= PER_LANGUAGE) {
    if (kept.length) out[l.id] = kept;
    continue;
  }
  const seen = new Set(kept.map((s) => s.text));
  const ids = new Set(kept.map((s) => s.id));
  const withBand = (s) => {
    const [min, max] = isCjk(s.text) ? [8, 40] : [20, 90];
    return { ...s, lenBand: Math.min(2, Math.floor(((s.text.length - min) / (max - min + 1)) * 3)) };
  };
  const picked = kept.map(withBand);
  const skipped = {};
  for (let round = 0; round < ROUNDS && picked.length < PER_LANGUAGE; round++) {
    for (const s of await page(l.id)) {
      const en = s.translations?.find((t) => t.lang === 'eng' && t.is_direct !== false && !t.is_unapproved);
      const text = s.text.trim();
      if (!en || s.is_unapproved || seen.has(text) || ids.has(s.id)) continue;
      // Chinese and Japanese pack a word into one or two characters.
      const [min, max] = isCjk(text) ? [8, 40] : [20, 90];
      if (text.length < min || text.length > max || /[\d\p{No}]/u.test(text)) continue;
      // A sentence that names its own language ("je parle français") gives the answer away.
      if ([l.name, ...l.aliases, 'tatoeba'].some((n) => n.length > 3 && fold(text).includes(fold(n).slice(0, -1)))) continue;
      const cand = withBand({ id: s.id, text, en: en.text.trim() });
      // Late rounds relax the variety rules a little so small languages still fill up.
      const why = repetitive(cand, picked);
      if (why && !(round >= ROUNDS - 3 && (why === 'length' || why === 'names'))) {
        skipped[why] = (skipped[why] ?? 0) + 1;
        continue;
      }
      seen.add(text);
      ids.add(s.id);
      picked.push(cand);
      if (picked.length >= PER_LANGUAGE) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (picked.length < 3) problems.push(`${l.id} (${l.name}): only ${picked.length} usable sentences — left out`);
  else {
    out[l.id] = picked.map(({ id, text, en }) => ({ id, text, en }));
    if (picked.length < PER_LANGUAGE) problems.push(`${l.id} (${l.name}): ${picked.length}/${PER_LANGUAGE}`);
  }
  console.log(`${l.id}: ${kept.length} kept + ${picked.length - kept.length} new  skipped ${JSON.stringify(skipped)}`);
}

// One sentence per line keeps the file (and the bundle) small.
const body = Object.entries(out)
  .map(([id, list]) => `  ${JSON.stringify(id)}: [\n${list.map((s) => '    ' + JSON.stringify(s)).join(',\n')}\n  ]`)
  .join(',\n');
writeFileSync(
  OUT,
  `// Generated by shared/scripts/fetch-sentences.mjs — do not edit (edit languages.ts and re-run).\n` +
    `// Sentences from Tatoeba (https://tatoeba.org), CC BY 2.0 FR. \`id\` is the Tatoeba sentence id.\n` +
    `export interface Sentence {\n  id: number;\n  text: string;\n  /** English translation */\n  en: string;\n}\n\n` +
    `export const SENTENCES: Record<string, Sentence[]> = {\n${body}\n};\n`,
);
if (problems.length) console.log('\nProblems:\n' + problems.map((p) => '  ' + p).join('\n'));
