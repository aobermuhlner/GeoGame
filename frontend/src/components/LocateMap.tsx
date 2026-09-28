import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RegionId } from '@flagduel/shared';
import type { LOCATE_MAP, LocateCountry } from '../generated/locatemap';

export type Mark = 'correct' | 'wrong' | 'target';

interface Props {
  /** Called with the ISO code of the clicked country (not called for drags or ocean clicks). */
  onPick?: (code: string) => void;
  /** Countries to colour in. */
  marks?: Record<string, Mark>;
  /** Animate the view to this country (e.g. to reveal the answer). */
  focus?: string | null;
  /** Zoom back out to the whole world whenever this changes. */
  resetKey?: string | number;
  /** Start (and reset) zoomed in on this region instead of the whole world. */
  region?: RegionId | null;
  /** Debug: show the hovered country's name. */
  showNames?: boolean;
  nameOf?: (code: string) => string;
  disabled?: boolean;
  /** The map is shown turned 90° clockwise by CSS (full screen on an upright phone). */
  rotated?: boolean;
  /** Another control over the map (e.g. a full-screen button). */
  extraControl?: ComponentChildren;
  /** Landmark id: a pin on its spot (Landmarks reveal) */
  pin?: string | null;
}

type MapData = typeof LOCATE_MAP;
interface View {
  k: number;
  x: number;
  y: number;
}

const NO_MARKS: Record<string, Mark> = {};
const MAX_ZOOM = 40;
const MARKER_R = 5; // on-screen px
const MARKER_HIT = 12; // on-screen px
const DRAG_PX = 5;

export function LocateMap({
  onPick,
  marks = NO_MARKS,
  focus,
  resetKey,
  region,
  showNames,
  nameOf,
  disabled,
  rotated = false,
  extraControl,
  pin,
}: Props) {
  const [map, setMap] = useState<MapData | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [unit, setUnit] = useState(1); // screen px per map unit at k = 1
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const rotatedRef = useRef(rotated);
  rotatedRef.current = rotated;
  const anim = useRef(0);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    let alive = true;
    import('../generated/locatemap').then((m) => alive && setMap(m.LOCATE_MAP));
    return () => {
      alive = false;
    };
  }, []);

  const W = map?.width ?? 1;
  const H = map?.height ?? 1;

  function clamp(v: View): View {
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k));
    return { k, x: Math.min(0, Math.max(W - W * k, v.x)), y: Math.min(0, Math.max(H - H * k, v.y)) };
  }

  /** Touch screens fire several moves per frame: re-render at most once a frame. */
  function set(v: View) {
    cancelAnimationFrame(anim.current);
    viewRef.current = clamp(v);
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setView(viewRef.current);
      });
    }
  }

  /** Client coordinates → map units (of the untransformed viewBox). */
  function toMap(cx: number, cy: number): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    // Turned clockwise: the map's top edge is on the right of the screen, its left edge at the top.
    if (rotatedRef.current) return [((cy - r.top) / r.height) * W, ((r.right - cx) / r.width) * H];
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H];
  }

  /** Pan by a pointer's movement from (ax, ay) to (bx, by), scaled by `f`. */
  function panBy(ax: number, ay: number, bx: number, by: number, f = 1) {
    const [x0, y0] = toMap(ax, ay);
    const [x1, y1] = toMap(bx, by);
    const v = viewRef.current;
    set({ ...v, x: v.x + (x1 - x0) * f, y: v.y + (y1 - y0) * f });
  }

  function zoomAt(px: number, py: number, factor: number, from = viewRef.current) {
    const k = Math.min(MAX_ZOOM, Math.max(1, from.k * factor));
    const f = k / from.k;
    set({ k, x: px - (px - from.x) * f, y: py - (py - from.y) * f });
  }

  function animateTo(target: View, ms = 650) {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const to = clamp(target);
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      // Interpolate zoom geometrically so the motion feels even.
      const k = from.k * Math.pow(to.k / from.k, e);
      const s = to.k === from.k ? e : (k - from.k) / (to.k - from.k);
      viewRef.current = { k, x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s };
      setView(viewRef.current);
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }

  // Track the rendered size, so markers keep a constant on-screen size.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // The layout size, which (unlike the bounding box) ignores the CSS rotation.
    const ro = new ResizeObserver(([e]) => setUnit(e.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  // Wheel zoom (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = toMap(e.clientX, e.clientY);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(px, py, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [map]);

  // Pan (drag), pinch zoom, and click detection.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; code: string | null; sx: number; sy: number; pinch?: number } | null>(null);

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    svgRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const code = (e.target as Element).closest?.('[data-c]')?.getAttribute('data-c') ?? null;
    if (pointers.current.size === 1) gesture.current = { moved: false, code, sx: e.clientX, sy: e.clientY };
    else if (gesture.current) {
      gesture.current.moved = true; // a second finger: never a click
      gesture.current.pinch = pinchDist();
    }
    cancelAnimationFrame(anim.current);
  }

  function pinchDist() {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (showNames && e.pointerType === 'mouse') {
        const code = (e.target as Element).closest?.('[data-c]')?.getAttribute('data-c');
        const r = svgRef.current!.getBoundingClientRect();
        setHover(code && !rotatedRef.current ? { code, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      }
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = pinchDist();
      const [a, b] = [...pointers.current.values()];
      const [px, py] = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (g.pinch) zoomAt(px, py, d / g.pinch);
      g.pinch = d;
      // Pan by the midpoint's movement (half of this finger's).
      panBy(prev.x, prev.y, e.clientX, e.clientY, 0.5);
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > DRAG_PX) g.moved = true;
    if (g.moved) panBy(prev.x, prev.y, e.clientX, e.clientY);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (g && !g.moved && g.code && !disabled) onPick?.(g.code);
    }
  }

  /** The view that shows box [x0, y0, x1, y1] (plus padding) as large as possible, centred. */
  function fit([x0, y0, x1, y1]: readonly number[], pad: number, maxK: number): View {
    const k = Math.min(maxK, W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2));
    return { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
  }

  /** Where a round starts: the selected region, or the whole world. */
  function home(): View {
    return map && region ? clamp(fit(map.views[region], 0, MAX_ZOOM)) : { k: 1, x: 0, y: 0 };
  }

  const atHome = () => {
    const v = viewRef.current;
    const h = home();
    return Math.abs(v.k - h.k) < 1e-6 && Math.abs(v.x - h.x) < 1e-3 && Math.abs(v.y - h.y) < 1e-3;
  };

  // Start on the region as soon as the map has loaded (no animation).
  useLayoutEffect(() => {
    if (map) setView((viewRef.current = home()));
  }, [map]);

  // Region changed (e.g. a rematch with other settings): glide there.
  const firstRegion = useRef(true);
  useEffect(() => {
    if (firstRegion.current) return void (firstRegion.current = false);
    if (map && !atHome()) animateTo(home(), 450);
  }, [region]);

  // Reveal / focus a country.
  useEffect(() => {
    if (!map || !focus) return;
    const c = map.countries.find((x) => x.c === focus);
    if (c) animateTo(fit(c.b, 90, 6));
  }, [focus, map]);

  // New round: back to the start view.
  useEffect(() => {
    if (map && !atHome()) animateTo(home(), 450);
  }, [resetKey]);

  const hoverCode = hover?.code ?? null;
  const cls = (c: LocateCountry) => {
    const m = marks[c.c];
    return `${m ? ` ${m}` : ''}${hoverCode === c.c ? ' hover' : ''}`;
  };

  // The ~250 country shapes only change with the marks or the hover, not while panning or zooming:
  // reusing the same elements lets Preact skip them on those re-renders.
  const land = useMemo(
    () =>
      map && (
        <>
          <g class="lm-zones">
            {map.countries.flatMap((c) =>
              (c.z ?? []).map((d, i) => <path key={`${c.c}${i}`} data-c={c.c} class={`lm-zone${cls(c)}`} d={d} />),
            )}
          </g>
          <path class="lm-other" d={map.other} />
          <g class="lm-land">
            {map.countries.map((c) => (
              <path key={c.c} data-c={c.c} class={`lm-country${cls(c)}`} d={c.d} />
            ))}
          </g>
        </>
      ),
    [map, marks, hoverCode],
  );

  if (!map) return <div class="locate-map loading" aria-hidden="true" />;

  const { k, x, y } = view;
  const u = unit * k; // screen px per map unit

  return (
    <div class="locate-wrap" style={{ aspectRatio: `${W} / ${H}`, '--ar': W / H }}>
      <svg
        ref={svgRef}
        class={`locate-map${disabled ? ' disabled' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="World map: click the country you are asked for. Scroll or pinch to zoom, drag to pan."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerOver={(e) => {
          const code = (e.target as Element).closest?.('[data-c]')?.getAttribute('data-c') ?? null;
          if (!showNames) setHover(code ? { code, x: 0, y: 0 } : null);
        }}
        onDblClick={(e) => {
          const [px, py] = toMap(e.clientX, e.clientY);
          zoomAt(px, py, 2.2);
        }}
      >
        <rect class="lm-ocean" width={W} height={H} />
        <g transform={`translate(${x} ${y}) scale(${k})`}>
          {land}
          <g class="lm-markers">
            {map.countries.flatMap((c) =>
              (c.m ?? []).map(([mx, my], i) => (
                <g key={`${c.c}${i}`} data-c={c.c} class={`lm-marker${cls(c)}`}>
                  <circle class="hit" cx={mx} cy={my} r={MARKER_HIT / u} />
                  <circle class="dot" cx={mx} cy={my} r={MARKER_R / u} />
                </g>
              )),
            )}
          </g>
          {pin && map.pins[pin] && (
            // Drawn at a constant on-screen size; the tip sits on the spot.
            <g class="lm-pin" transform={`translate(${map.pins[pin][0]} ${map.pins[pin][1]}) scale(${1 / u})`}>
              <path d="M0 0c-3-6-10-11-10-18a10 10 0 0 1 20 0c0 7-7 12-10 18z" />
              <circle cy="-18" r="3.8" />
            </g>
          )}
        </g>
      </svg>

      <div class="lm-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAnimated(1.8)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAnimated(1 / 1.8)}>
          −
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" onClick={() => animateTo(home())}>
          ⤢
        </button>
      </div>
      {extraControl}

      {showNames && hover && hover.x > 0 && (
        <div class="lm-tip" style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
          {nameOf ? nameOf(hover.code) : hover.code}
        </div>
      )}
    </div>
  );

  function zoomAnimated(f: number) {
    const v = viewRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k * f));
    const cx = W / 2;
    const cy = H / 2;
    animateTo({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }, 300);
  }
}
