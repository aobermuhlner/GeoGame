// Landmarks game: place a pin on the world map, pick a circle around it, lock it in. The landmark has to be
// inside the circle; the smaller the circle, the more it is worth. The reveal shows everyone's circles.
// The photo and the map share one stage that fills the screen. Rounds start with the photo large and the map
// small in the corner: the small map works as it is (zoom, pan, pin), or its button makes it the large one
// (click the small photo to swap back). The reveal shows the map with the photo beside it.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  LANDMARK_META,
  PIN_DEFAULT_RADIUS,
  PIN_POINTS,
  PIN_RADII,
  destination,
  formatPin,
  parsePin,
  project,
  unproject,
  type GuessOutcome,
  type MapProjection,
  type Pin,
  type RegionId,
} from '@flagduel/shared';
import { LocateMap, isPacific, loadLocateMap, useRegionFocus } from './LocateMap';

export interface RevealPin {
  /** The locked-in answer ("lat,lon,km") */
  answer: string;
  /** "You", or the player's name */
  label: string;
  me: boolean;
  correct: boolean;
}

interface Props {
  /** The round's photo (or the countdown before it) */
  photo: ComponentChildren;
  /** Changes every round: clears the pin */
  roundKey: string | number;
  /** No pin can be placed or locked in (countdown, reveal, passed, already locked in) */
  locked: boolean;
  onLock: (text: string) => Promise<GuessOutcome> | GuessOutcome | void;
  /** The pin as it is now (placed or resized), so it counts even if the time runs out before "Lock in" */
  onDraft?: (text: string) => void;
  /** Your locked-in answer, kept on the map until the reveal */
  mine?: string | null;
  /** The round is over: the landmark and every answer */
  reveal?: { landmark: string; pins: RevealPin[] } | null;
  regions?: readonly RegionId[];
  /** What each radius is worth, shown on its button (default: duel points) */
  worth?: (i: number) => string;
  /** More buttons beside "Lock in" (Pass, Next round) */
  actions?: ComponentChildren;
}

const duelWorth = (i: number) => `${PIN_POINTS[i]} pt${PIN_POINTS[i] === 1 ? '' : 's'}`;

/** The projection of the map shown (from the lazily loaded map module). */
function useProjection(pacific: boolean): MapProjection | null {
  const [proj, setProj] = useState<MapProjection | null>(null);
  useEffect(() => {
    let alive = true;
    setProj(null);
    loadLocateMap(pacific).then((m) => alive && setProj(m.proj));
    return () => {
      alive = false;
    };
  }, [pacific]);
  return proj;
}

/** The circle of `km` around (lat, lon) as an SVG path in map units, split where it crosses the map's seam. */
function circlePath(proj: MapProjection, lat: number, lon: number, km: number): string {
  const pts: [number, number][] = [];
  const [cx] = project(proj, lat, lon);
  for (let b = 0; b <= 360; b += 5) {
    const [la, lo] = destination(lat, lon, km, b);
    pts.push(project(proj, la, lo, cx));
  }
  let d = '';
  pts.forEach(([x, y], i) => {
    const jump = i > 0 && Math.abs(x - pts[i - 1][0]) > 500;
    d += `${i === 0 || jump ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d;
}

/** A map pin drawn at a constant on-screen size, its tip on (x, y). */
function PinMark({ x, y, u, cls, label }: { x: number; y: number; u: number; cls: string; label?: string }) {
  return (
    <g class={`pb-pin ${cls}`} transform={`translate(${x} ${y}) scale(${1 / u})`}>
      <path d="M0 0c-3-6-10-11-10-18a10 10 0 0 1 20 0c0 7-7 12-10 18z" />
      <circle cy="-18" r="3.8" />
      {label && (
        <text x="13" y="-14">
          {label}
        </text>
      )}
    </g>
  );
}

export function PinBoard({
  photo,
  roundKey,
  locked,
  onLock,
  onDraft,
  mine,
  reveal,
  regions = [],
  worth = duelWorth,
  actions,
}: Props) {
  const { partial, active } = useRegionFocus(regions);
  const proj = useProjection(partial && isPacific(regions));
  const [spot, setSpot] = useState<[number, number] | null>(null);
  const [km, setKm] = useState<number>(PIN_DEFAULT_RADIUS);
  const [pending, setPending] = useState(false);
  const [mapBig, setMapBig] = useState(false);

  useEffect(() => {
    setSpot(null);
    setKm(PIN_DEFAULT_RADIUS);
    setPending(false);
    setMapBig(false);
  }, [roundKey]);

  const mineParsed = mine ? parsePin(mine) : null;
  const blocked = locked || pending || !!mineParsed;

  // Every change to the pin is sent as a draft: the last one is locked in when the time runs out.
  const draftText = spot ? formatPin({ lat: spot[0], lon: spot[1], km }) : null;
  useEffect(() => {
    if (draftText && !blocked) onDraft?.(draftText);
  }, [draftText]);

  function tap(x: number, y: number) {
    if (blocked || !proj) return;
    const ll = unproject(proj, x, y);
    if (ll) setSpot(ll);
  }

  async function lock() {
    if (!spot || blocked) return;
    setPending(true);
    try {
      await onLock(formatPin({ lat: spot[0], lon: spot[1], km }));
    } finally {
      setPending(false);
    }
  }

  // What to draw: during the round your own pin; on the reveal everyone's, plus the landmark.
  const drawn: (Pin & { cls: string; label?: string })[] = reveal
    ? reveal.pins.flatMap((p) => {
        const pin = parsePin(p.answer);
        return pin ? [{ ...pin, cls: `${p.me ? 'me' : 'opp'} ${p.correct ? 'ok' : 'bad'}`, label: p.label }] : [];
      })
    : mineParsed
      ? [{ ...mineParsed, cls: 'me locked' }]
      : spot
        ? [{ lat: spot[0], lon: spot[1], km, cls: 'me' }]
        : [];
  const target = reveal ? LANDMARK_META[reveal.landmark] : null;

  const shapes = useMemo(() => {
    if (!proj) return null;
    const pins = drawn.map((p) => ({ ...p, xy: project(proj, p.lat, p.lon), ring: circlePath(proj, p.lat, p.lon, p.km) }));
    const t = target && target.lat !== null && target.lon !== null ? project(proj, target.lat, target.lon) : null;
    return { pins, t };
  }, [proj, JSON.stringify(drawn), target]);

  // Reveal: frame the landmark and everyone's pins.
  const focusBox = useMemo(() => {
    if (!shapes?.t || !reveal) return null;
    const xs = [shapes.t[0], ...shapes.pins.map((p) => p.xy[0])];
    const ys = [shapes.t[1], ...shapes.pins.map((p) => p.xy[1])];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }, [shapes, reveal]);

  return (
    <div class="pin-board">
      <div class={`pin-stage ${reveal ? 'revealed' : mapBig ? 'map-big' : 'photo-big'}`}>
        <div class="ps-pane ps-photo">
          <div class="ps-photo-box">{photo}</div>
          {mapBig && !reveal && (
            <button type="button" class="ps-cover" aria-label="Show the photo" onClick={() => setMapBig(false)}>
              <span class="ps-label">Photo</span>
            </button>
          )}
        </div>
        <div class="ps-pane ps-map">
          <LocateMap
            fill
            onTap={tap}
            resetKey={roundKey}
            region={partial ? regions : null}
            active={active}
            disabled={blocked && !reveal}
            focusBox={focusBox}
            layer={(u) =>
              shapes && (
                <g class="pb-layer">
                  {shapes.pins.map((p, i) => (
                    <path key={`r${i}`} class={`pb-ring ${p.cls}`} d={p.ring} />
                  ))}
                  {shapes.t &&
                    shapes.pins.map((p, i) => (
                      <line
                        key={`l${i}`}
                        class="pb-miss"
                        x1={p.xy[0]}
                        y1={p.xy[1]}
                        x2={shapes.t![0]}
                        y2={shapes.t![1]}
                      />
                    ))}
                  {shapes.pins.map((p, i) => (
                    <PinMark key={`p${i}`} x={p.xy[0]} y={p.xy[1]} u={u} cls={p.cls} label={p.label} />
                  ))}
                  {shapes.t && <PinMark x={shapes.t[0]} y={shapes.t[1]} u={u} cls="target" />}
                </g>
              )
            }
          />
          {!reveal && !spot && !mineParsed && !locked && (
            <div class="pin-tip">{mapBig ? 'Tap the map to place your pin' : 'Click to pin · scroll to zoom'}</div>
          )}
          {!mapBig && !reveal && (
            <button type="button" class="ps-grow" aria-label="Bigger map" title="Bigger map" onClick={() => setMapBig(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {(!reveal || actions) && (
        <div class="pin-controls">
          {!reveal && (
            <>
              <div class="pin-radii" role="radiogroup" aria-label="Circle size">
                {PIN_RADII.map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={(mineParsed?.km ?? km) === r}
                    class={`pin-radius${(mineParsed?.km ?? km) === r ? ' on' : ''}`}
                    disabled={blocked}
                    onClick={() => setKm(r)}
                  >
                    <strong>{r.toLocaleString('en-US')} km</strong>
                    <span>{worth(i)}</span>
                  </button>
                ))}
              </div>
              <button class="btn btn-primary pin-lock" type="button" disabled={blocked || !spot} onClick={lock}>
                {mineParsed ? 'Locked in' : 'Lock in'}
              </button>
            </>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
