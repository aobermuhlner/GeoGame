import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { REGION_IDS, countriesInRegions, type RegionId } from '@flagduel/shared';
import type { LOCATE_MAP, LocateCountry } from '../generated/locatemap';

/** 'other': another player's wrong click (multiplayer) */
export type Mark = 'correct' | 'wrong' | 'target' | 'missed' | 'other';

interface Props {
  /** Called with the ISO code of the clicked country (not called for drags or ocean clicks). */
  onPick?: (code: string) => void;
  /** Countries to colour in. */
  marks?: Record<string, Mark>;
  /** Animate the view to this country (e.g. to reveal the answer). */
  focus?: string | null;
  /** Zoom back out to the whole world whenever this changes. */
  resetKey?: string | number;
  /** Only these countries are in play: the others are greyed out and can't be clicked (null: all). */
  active?: ReadonlySet<string> | null;
  /**
   * Start (and reset) zoomed in on this region (or these regions together) instead of the whole world.
   * Oceania alone gets the map with the Pacific continued east of the seam, so it can sit centred.
   */
  region?: RegionId | readonly RegionId[] | null;
  /** Size the map's frame to the region (taller for compact regions, up to the window's height) */
  snug?: boolean;
  /** Write these countries' names on the map (with `nameOf`), e.g. to reveal what was missed. */
  labels?: readonly string[];
  /** Extra class of a label's text */
  labelClass?: (code: string) => string;
  /** Fill the parent's box (any shape) instead of keeping the map's own aspect ratio */
  fill?: boolean;
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
  /**
   * Pin mode (Landmarks): called with the tapped point in map units, anywhere on the map (no country
   * picking, no hover highlight).
   */
  onTap?: (x: number, y: number) => void;
  /** Drawn over the map, in map units; `u` = screen px per map unit (for constant on-screen sizes) */
  layer?: (u: number) => ComponentChildren;
  /** Animate the view to show this box [x0, y0, x1, y1] (map units) */
  focusBox?: readonly number[] | null;
}

type MapData = typeof LOCATE_MAP;

const regionList = (region: RegionId | readonly RegionId[] | null | undefined): readonly RegionId[] =>
  region ? (typeof region === 'string' ? [region] : region) : [];

/** Whether these regions use the map with the Pacific continued east (Oceania on its own). */
export const isPacific = (region: RegionId | readonly RegionId[] | null | undefined) => {
  const ids = regionList(region);
  return ids.length === 1 && ids[0] === 'oceania';
};

/** The map data (lazily loaded; the Pacific variant only when needed). */
export const loadLocateMap = (pacific: boolean): Promise<MapData> =>
  pacific ? import('../generated/locatemap-pacific').then((m) => m.LOCATE_MAP) : import('../generated/locatemap').then((m) => m.LOCATE_MAP);

/**
 * A match over some of the regions: zoom to them and grey out the rest of the world. `partial` is false
 * (and `active` null) when every region is in play.
 */
export function useRegionFocus(regions: readonly RegionId[]) {
  const key = regions.join();
  return useMemo(() => {
    const partial = regions.length > 0 && regions.length < REGION_IDS.length;
    return { partial, active: partial ? new Set(countriesInRegions(regions)) : null };
  }, [key]);
}
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
const LABEL_PX = 11; // on-screen px

export function LocateMap({
  onPick,
  marks = NO_MARKS,
  focus,
  resetKey,
  active = null,
  region,
  snug = false,
  labels,
  labelClass,
  fill = false,
  showNames,
  nameOf,
  disabled,
  rotated = false,
  extraControl,
  pin,
  onTap,
  layer,
  focusBox,
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
  /** The view is (or is gliding to) the start view */
  const homing = useRef(true);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const regions = regionList(region);
  const regionKey = regions.join();
  const pacific = isPacific(regions);
  useEffect(() => {
    let alive = true;
    loadLocateMap(pacific).then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [pacific]);

  const [winH, setWinH] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!snug) return;
    const on = () => setWinH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [snug]);

  // Fill: the frame's width / height, measured from the box the map sits in.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [frameAr, setFrameAr] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!fill || !el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setFrameAr(Math.round((width / height) * 1000) / 1000);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, fill]);

  const W = map?.width ?? 1;
  const H = map?.height ?? 1;
  /** The region's box [x0, y0, x1, y1] (map units), or null for the whole world */
  const regionBox = useMemo(() => {
    if (!map || regions.length === 0) return null;
    const boxes = regions.map((r) => map.views[r]);
    return [0, 1, 2, 3].map((i) => (i < 2 ? Math.min : Math.max)(...boxes.map((b) => b[i])));
  }, [map, regionKey]);
  // Height of the visible frame in map units: the map's own height, or (snug) taller, so the frame takes the
  // region's shape (a little wider), as far as the window's height allows.
  const maxPx = Math.max(280, winH - 270); // room for the page's header card above
  const VH = useMemo(() => {
    if (fill) return frameAr ? W / frameAr : H;
    if (!snug || !regionBox) return H;
    const [x0, y0, x1, y1] = regionBox;
    const aspect = Math.min(W / H, Math.max(((x1 - x0) / (y1 - y0)) * 1.12, (unit * W) / maxPx));
    return W / aspect;
  }, [snug, fill, frameAr, regionBox, maxPx, unit, W, H]);

  /** Keep the map covering the frame: at least as zoomed in as the frame's height needs. */
  function clamp(v: View): View {
    const k = Math.min(MAX_ZOOM, Math.max(1, VH / H, v.k));
    return { k, x: Math.min(0, Math.max(W - W * k, v.x)), y: Math.min(0, Math.max(VH - H * k, v.y)) };
  }

  /** Touch screens fire several moves per frame: re-render at most once a frame. */
  function set(v: View) {
    homing.current = false;
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
    if (rotatedRef.current) return [((cy - r.top) / r.height) * W, ((r.right - cx) / r.width) * VH];
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * VH];
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
      if (!g || g.moved || disabled) return;
      if (onTap) {
        const [px, py] = toMap(e.clientX, e.clientY);
        const v = viewRef.current;
        onTap((px - v.x) / v.k, (py - v.y) / v.k);
      } else if (g.code) onPick?.(g.code);
    }
  }

  /** The view that shows box [x0, y0, x1, y1] (plus padding) as large as possible, centred. */
  function fit([x0, y0, x1, y1]: readonly number[], pad: number, maxK: number): View {
    const k = Math.min(maxK, W / (x1 - x0 + pad * 2), VH / (y1 - y0 + pad * 2));
    return { k, x: W / 2 - ((x0 + x1) / 2) * k, y: VH / 2 - ((y0 + y1) / 2) * k };
  }

  /** Where a round starts: the selected region, or the whole world (centred when the frame's shape differs). */
  function home(): View {
    if (regionBox) return clamp(fit(regionBox, 0, MAX_ZOOM));
    const k = Math.max(1, VH / H);
    return clamp({ k, x: (W - W * k) / 2, y: (VH - H * k) / 2 });
  }

  /** Back to the start view; it stays there if the frame changes shape. */
  function goHome(ms?: number) {
    homing.current = true;
    if (!atHome()) animateTo(home(), ms);
  }

  const atHome = () => {
    const v = viewRef.current;
    const h = home();
    return Math.abs(v.k - h.k) < 1e-6 && Math.abs(v.x - h.x) < 1e-3 && Math.abs(v.y - h.y) < 1e-3;
  };

  // Start on the region as soon as the map has loaded (no animation).
  // Also when the frame changes shape (window resized, or measured for the first time).
  // A filled frame that changes shape keeps its view (or what `focusBox` frames); anything else starts at home.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!map || (fill && !frameAr)) return;
    if (fill && placed.current && !homing.current) {
      if (focusBox) animateTo(fit(focusBox, 60, 8));
      else setView((viewRef.current = clamp(viewRef.current)));
    } else {
      cancelAnimationFrame(anim.current);
      setView((viewRef.current = home()));
    }
    placed.current = true;
  }, [map, VH]);

  // Region changed (e.g. a rematch with other settings): glide there.
  const firstRegion = useRef(true);
  useEffect(() => {
    if (firstRegion.current) return void (firstRegion.current = false);
    if (map) goHome(450);
  }, [regionKey]);

  // Reveal / focus a country.
  useEffect(() => {
    if (!map || !focus) return;
    const c = map.countries.find((x) => x.c === focus);
    if (!c) return;
    homing.current = false;
    animateTo(fit(c.b, 90, 6));
  }, [focus, map]);

  const boxKey = focusBox?.join(',');
  useEffect(() => {
    if (!map || !focusBox) return;
    homing.current = false;
    animateTo(fit(focusBox, 60, 8));
  }, [boxKey, map]);

  // New round: back to the start view.
  useEffect(() => {
    if (map) goHome(450);
  }, [resetKey]);

  const hoverCode = hover?.code ?? null;
  const cls = (c: LocateCountry) => {
    if (active && !active.has(c.c)) return ' off';
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
    [map, marks, hoverCode, active],
  );

  if (!map) return <div class="locate-map loading" aria-hidden="true" />;

  const { k, x, y } = view;
  const u = unit * k; // screen px per map unit

  return (
    <div
      ref={wrapRef}
      class={`locate-wrap${fill ? ' fill' : ''}`}
      // Snug: never taller than the window allows (on a short window the map gets narrower instead).
      style={
        fill
          ? undefined
          : { aspectRatio: `${W} / ${VH}`, '--ar': W / VH, ...(snug && { maxWidth: `${(maxPx * W) / VH}px`, margin: '0 auto' }) }
      }
    >
      <svg
        ref={svgRef}
        class={`locate-map${disabled ? ' disabled' : ''}${onTap ? ' pin-mode' : ''}`}
        viewBox={`0 0 ${W} ${VH}`}
        role="img"
        aria-label="World map: click the country you are asked for. Scroll or pinch to zoom, drag to pan."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerOver={(e) => {
          if (onTap) return;
          const code = (e.target as Element).closest?.('[data-c]')?.getAttribute('data-c') ?? null;
          if (!showNames) setHover(code ? { code, x: 0, y: 0 } : null);
        }}
        onDblClick={(e) => {
          const [px, py] = toMap(e.clientX, e.clientY);
          zoomAt(px, py, 2.2);
        }}
      >
        <rect class="lm-ocean" width={W} height={VH} />
        <g transform={`translate(${x} ${y}) scale(${k})`}>
          {land}
          <g class="lm-markers">
            {map.countries.filter((c) => !active || active.has(c.c)).flatMap((c) =>
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
          {layer?.(u)}
          {labels && labels.length > 0 && (
            // A constant on-screen size, so zooming in pulls crowded labels apart.
            <g class="lm-labels" style={{ fontSize: `${LABEL_PX / u}px`, strokeWidth: `${(LABEL_PX / 3.5) / u}px` }}>
              {labels.map((code) => {
                const c = map.countries.find((x) => x.c === code);
                return c && (
                  <text key={code} x={c.l[0]} y={c.l[1]} class={labelClass?.(code) || undefined}>
                    {nameOf ? nameOf(code) : code}
                  </text>
                );
              })}
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
        <button type="button" aria-label="Reset view" title="Reset view" onClick={() => goHome()}>
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
    homing.current = false;
    const v = viewRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k * f));
    const cx = W / 2;
    const cy = VH / 2;
    animateTo({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }, 300);
  }
}
