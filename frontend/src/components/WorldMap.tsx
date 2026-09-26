import { useEffect, useState } from 'preact/hooks';
import { REGION_IDS, REGION_LABELS, countriesInRegions, type RegionId } from '@flagduel/shared';
import type { WORLD_MAP } from '../generated/worldmap';

export const REGION_COLORS: Record<RegionId, string> = {
  europe: '#4a78a8',
  asia: '#d4953a',
  africa: '#c0603e',
  oceania: '#2f9a96',
  'north-america': '#7c9a3c',
  'central-america': '#8d6bb3',
  caribbean: '#d0668a',
  'south-america': '#3c8a58',
};

/** Regions whose shapes are tiny at this scale get a generous invisible hit area. */
const SMALL: RegionId[] = ['central-america', 'caribbean', 'oceania'];

interface Props {
  selected: RegionId[];
  editable: boolean;
  onToggle: (r: RegionId) => void;
}

type MapData = typeof WORLD_MAP;

export function WorldMap({ selected, editable, onToggle }: Props) {
  const [map, setMap] = useState<MapData | null>(null);

  useEffect(() => {
    let alive = true;
    import('../generated/worldmap').then((m) => alive && setMap(m.WORLD_MAP));
    return () => {
      alive = false;
    };
  }, []);

  if (!map) return <div class="world-map loading" aria-hidden="true" />;

  return (
    <svg
      class={`world-map${editable ? ' editable' : ''}`}
      viewBox={`0 0 ${map.width} ${map.height}`}
      role="group"
      aria-label={editable ? 'World map: click a region to include or exclude it' : 'World map of the selected regions'}
    >
      <path class="map-other" d={map.other} />
      {REGION_IDS.map((r) => {
        const on = selected.includes(r);
        const label = `${REGION_LABELS[r]} · ${countriesInRegions([r]).length} countries${on ? '' : ' (excluded)'}`;
        const toggle = () => editable && onToggle(r);
        return (
          <g
            key={r}
            class={`map-region${on ? ' on' : ''}`}
            style={{ '--c': REGION_COLORS[r] }}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-pressed={editable ? on : undefined}
            aria-label={label}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
              }
            }}
          >
            <title>{label}</title>
            {SMALL.includes(r) && <path class="hit" d={map.regions[r]} />}
            <path class="shape" d={map.regions[r]} />
            {map.dots[r].map(([x, y], i) => (
              <g key={i}>
                <circle class="hit" cx={x} cy={y} r={9} />
                <circle class="dot" cx={x} cy={y} r={3.2} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
