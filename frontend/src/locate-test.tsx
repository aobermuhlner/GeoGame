// Dev-only playground for the GeoLocate map (open /geolocate-test.html on the Vite dev server).
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { COUNTRIES, COUNTRY_BY_CODE, REGION_IDS, REGION_LABELS, type RegionId } from '@flagduel/shared';
import { Logo } from './components/common';
import { LocateMap, type Mark } from './components/LocateMap';
import './styles.css';

const nameOf = (c: string) => COUNTRY_BY_CODE[c]?.name ?? c;

function pick(region: RegionId | 'all', not?: string) {
  const pool = COUNTRIES.filter((c) => (region === 'all' || c.region === region) && c.code !== not);
  return pool[Math.floor(Math.random() * pool.length)].code;
}

function Playground() {
  const [region, setRegion] = useState<RegionId | 'all'>('all');
  const [target, setTarget] = useState(() => pick('all'));
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; picked: string } | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [names, setNames] = useState(false);

  function next(r = region) {
    setTarget(pick(r, target));
    setMarks({});
    setFocus(null);
    setResult(null);
  }

  function onPick(code: string) {
    if (result) return;
    const ok = code === target;
    setResult({ ok, picked: code });
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }));
    setMarks(ok ? { [code]: 'correct' } : { [code]: 'wrong', [target]: 'target' });
    if (!ok) setFocus(target);
  }

  useEffect(() => {
    if (!result?.ok) return;
    const t = setTimeout(() => next(), 900);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <main class="locate-page">
      <section class="card locate-card">
        <header class="locate-head">
          <div class="brand">
            <Logo size={36} />
            <h1>
              Geo<em>Locate</em>
            </h1>
          </div>
          <span class="locate-score">
            {score.right} / {score.total}
          </span>
        </header>

        <div class={`locate-prompt${result ? (result.ok ? ' ok' : ' bad') : ''}`} aria-live="polite">
          {!result && (
            <>
              <span class="muted">Find</span> <strong>{nameOf(target)}</strong>
            </>
          )}
          {result?.ok && (
            <>
              ✓ <strong>{nameOf(target)}</strong>
            </>
          )}
          {result && !result.ok && (
            <>
              That's {nameOf(result.picked)}. <strong>{nameOf(target)}</strong> is highlighted.
            </>
          )}
        </div>

        <LocateMap
          onPick={onPick}
          marks={marks}
          focus={focus}
          resetKey={target}
          region={region === 'all' ? null : region}
          showNames={names}
          nameOf={nameOf}
        />

        <div class="locate-bar">
          <select
            class="text-input"
            value={region}
            onChange={(e) => {
              const r = (e.target as HTMLSelectElement).value as RegionId | 'all';
              setRegion(r);
              next(r);
            }}
          >
            <option value="all">All countries</option>
            {REGION_IDS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
          <label class="muted small">
            <input type="checkbox" checked={names} onChange={(e) => setNames((e.target as HTMLInputElement).checked)} />{' '}
            Show names on hover (test)
          </label>
          <button class="btn btn-primary" onClick={() => next()}>
            {result && !result.ok ? 'Next' : 'Skip'}
          </button>
        </div>
        <p class="muted small">Scroll or pinch to zoom · drag to pan · double-click to zoom in</p>
      </section>
    </main>
  );
}

render(<Playground />, document.getElementById('app')!);
