import { describe, expect, it } from 'vitest';
import { project, unproject, type MapProjection } from './pin';

// The GeoLocate map's projection (frontend/src/generated/locatemap.ts).
const P: MapProjection = { k: 378.0476, tx: 978.3194, ty: 527.0512, rot: -11, east: { west: -169, east: -120, north: 30 } };

describe('map projection with the Pacific continued east', () => {
  it('puts the Pacific east of the seam past the right edge, and Alaska at the left', () => {
    const [hawaii] = project(P, 19.6, -155.5);
    const [fiji] = project(P, -17.7, 178);
    const [alaska] = project(P, 61.2, -149.9);
    expect(hawaii).toBeGreaterThan(fiji);
    expect(hawaii).toBeGreaterThan(2000);
    expect(alaska).toBeLessThan(400);
  });

  it('turns map points back into the same places', () => {
    for (const [lat, lon] of [[19.6, -155.5], [-17.7, 178], [61.2, -149.9], [48.86, 2.29], [-25, -130]]) {
      const [x, y] = project(P, lat, lon);
      const back = unproject(P, x, y)!;
      expect(back[0]).toBeCloseTo(lat, 3);
      expect(back[1]).toBeCloseTo(lon, 3);
    }
  });

  it('leaves the zone’s old place at the left edge empty', () => {
    const [x, y] = project({ ...P, east: undefined }, 19.6, -155.5);
    expect(unproject(P, x, y)).toBeNull();
  });

  it('keeps a circle near the zone on the side of its centre', () => {
    const [cx] = project(P, 25, -150);
    expect(project(P, 35, -150, cx)[0]).toBeGreaterThan(2000);
    expect(project(P, 35, -150)[0]).toBeLessThan(200);
  });
});
