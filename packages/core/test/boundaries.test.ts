import { describe, expect, it } from 'vitest';
import {
  blindFacades,
  boundaryEdgeKey,
  classifyBoundary,
  defaultSettings,
  massLayout,
  massToSolids,
  rect,
  ringBBox,
  siteEdges,
  subtractSegments,
  type Site,
  type Surroundings,
  type Vec2,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
type Seg = [Vec2, Vec2];
const len = (segs: Seg[]) =>
  segs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);

// site 0…60 × 0…40; street (cadastre gap) to the south, neighbour parcels west, north and east
const site: Site = {
  parcels: [{ id: 'p', source: 'cadastre', ref: 'SITE', polygon: rect(0, 0, 60, 40) }],
  boundary: rect(0, 0, 60, 40),
};
const surroundings: Surroundings = {
  roads: [
    {
      id: 'r',
      centerline: [
        [-50, -6],
        [110, -6],
      ],
      width: 6,
      widthEstimated: false,
      kind: 'residential',
      name: 'Rue de Test',
      level: 0,
      source: 'ign',
    },
  ],
  green: [],
  trees: [],
  water: [],
  parcels: [
    { id: 'site', ref: 'SITE', polygon: rect(0, 0, 60, 40) },
    { id: 'w', ref: 'W', polygon: rect(-30, 0, 0, 40) },
    { id: 'n', ref: 'N', polygon: rect(-30, 40, 90, 80) },
    { id: 'e', ref: 'E', polygon: rect(60, 0, 90, 40) },
  ],
};

describe('site boundaries', () => {
  it('tells streets from neighbouring parcels', () => {
    const segs = classifyBoundary(site, surroundings);
    const kindAt = (x: number, y: number) =>
      segs.find(
        (s) =>
          Math.abs((s.b[0] - s.a[0]) * (y - s.a[1]) - (s.b[1] - s.a[1]) * (x - s.a[0])) < 1e-6 &&
          Math.min(s.a[0], s.b[0]) - 1e-6 <= x &&
          x <= Math.max(s.a[0], s.b[0]) + 1e-6 &&
          Math.min(s.a[1], s.b[1]) - 1e-6 <= y &&
          y <= Math.max(s.a[1], s.b[1]) + 1e-6,
      );
    expect(kindAt(30, 0)?.kind).toBe('road');
    expect(kindAt(30, 0)?.name).toBe('Rue de Test');
    expect(kindAt(0, 20)?.kind).toBe('neighbour');
    expect(kindAt(30, 40)?.kind).toBe('neighbour');
    expect(kindAt(60, 20)?.kind).toBe('neighbour');
  });

  it('splits an edge that is partly street, partly neighbour', () => {
    const s2: Surroundings = {
      ...surroundings,
      // the street ends at x = 20, a neighbour parcel lies south of the eastern half
      roads: [
        {
          ...surroundings.roads[0]!,
          centerline: [
            [-50, -6],
            [20, -6],
          ],
        },
      ],
      parcels: [...surroundings.parcels, { id: 's', ref: 'S', polygon: rect(30, -20, 90, 0) }],
    };
    const south = classifyBoundary(site, s2).filter((s) => s.a[1] === 0 && s.b[1] === 0);
    expect(south.map((s) => s.kind).sort()).toEqual(['neighbour', 'road']);
  });

  it('is unknown without cadastre data and follows user overrides', () => {
    expect(
      classifyBoundary(site, { ...surroundings, parcels: [] }).every((s) => s.kind === 'unknown'),
    ).toBe(true);
    const ring = site.boundary.outer;
    const i = ring.findIndex((p, k) => p[1] === 0 && ring[(k + 1) % ring.length]![1] === 0);
    const key = boundaryEdgeKey(ring[i]!, ring[(i + 1) % ring.length]!);
    const over = classifyBoundary({ ...site, edgeKinds: { [key]: 'neighbour' } }, surroundings);
    const south = over.filter((s) => s.key === key);
    expect(south).toHaveLength(1);
    expect(south[0]!.kind).toBe('neighbour');
    expect(south[0]!.auto).toBe('road');
    expect(south[0]!.overridden).toBe(true);
  });

  it('finds façades facing a neighbour boundary within the vue distance', () => {
    const b = rect(10, 30, 50, 36); // north façade 4 m from the boundary y = 40
    const edges: Seg[] = b.outer.map((p, i) => [p, b.outer[(i + 1) % b.outer.length]!]);
    const party: Seg[] = [
      [
        [0, 40],
        [60, 40],
      ],
    ];
    const blind = blindFacades(edges, [b], party, 8);
    expect(len(blind)).toBeCloseTo(40, 0); // only the north façade, not the gables
    expect(len(blindFacades(edges, [b], party, 3))).toBe(0);
    expect(len(subtractSegments(edges, blind))).toBeCloseTo(40 + 12, 0);
  });

  it('keeps windows and balconies off façades towards a neighbour', () => {
    // a bar along the northern neighbour boundary
    const m = mass({ kind: 'zeile', length: 40, depth: 13, sections: 1, sectionOffset: 0 });
    const solids = massToSolids(m, settings);
    const fp = solids.find((s) => s.storeyIndex === 2)!.footprint;
    const bb = ringBBox(fp.outer);
    // put the site boundary 3 m north of the bar; the street 10 m south of it
    const sSite: Site = {
      parcels: [],
      boundary: rect(bb.minX - 10, bb.minY - 10, bb.maxX + 10, bb.maxY + 3),
    };
    const sSur: Surroundings = {
      roads: [],
      green: [],
      trees: [],
      water: [],
      parcels: [{ id: 'n', polygon: rect(bb.minX - 30, bb.maxY + 3, bb.maxX + 30, bb.maxY + 40) }],
    };
    const edges = siteEdges(sSite, sSur);
    expect(edges?.party.length).toBe(1);
    const free = massLayout(m, solids, settings);
    const ml = massLayout(m, solids, settings, undefined, edges);
    const st = ml.storeys.find((s) => s.storeyIndex === 2)!;
    expect(len(st.blindFacades ?? [])).toBeCloseTo(40, 0);
    expect(free.storeys.find((s) => s.storeyIndex === 2)!.blindFacades).toBeUndefined();
    const northY = bb.maxY;
    for (const u of st.units) {
      // no façade piece (windows) on the north side
      for (const [a, b] of u.facadeSegments ?? [])
        expect(Math.abs(a[1] - northY) < 0.05 && Math.abs(b[1] - northY) < 0.05).toBe(false);
      // no outdoor space on the north side
      if (u.outdoor) expect(u.outdoor.side).not.toBe('N');
      // living rooms keep their façade (south)
      const sej = u.rooms.find((r) => r.kind === 'sejour');
      if (sej) expect(sej.facadeOk).toBe(true);
    }
  });

  it('turns the access side (gallery) towards a neighbour boundary', () => {
    const m = mass(
      { kind: 'zeile', length: 40, depth: 11, sections: 1, sectionOffset: 0 },
      { access: 'laubengang' },
    );
    const solids = massToSolids(m, settings);
    const fp = solids.find((s) => s.storeyIndex === 2)!.footprint;
    const bb = ringBBox(fp.outer);
    const sSite: Site = {
      parcels: [],
      boundary: rect(bb.minX - 10, bb.minY - 3, bb.maxX + 10, bb.maxY + 20),
    };
    const sSur: Surroundings = {
      roads: [],
      green: [],
      trees: [],
      water: [],
      parcels: [{ id: 's', polygon: rect(bb.minX - 30, bb.minY - 40, bb.maxX + 30, bb.minY - 3) }],
    };
    const st = massLayout(m, solids, settings, undefined, siteEdges(sSite, sSur)).storeys.find(
      (s) => s.storeyIndex === 2,
    )!;
    const gallery = st.circulation.filter((c) => c.kind === 'gallery');
    expect(gallery.length).toBeGreaterThan(0);
    // the gallery runs along the southern (blind) façade
    for (const g of gallery) expect(ringBBox(g.polygon.outer).minY).toBeCloseTo(bb.minY, 1);
    const free = massLayout(m, solids, settings).storeys.find((s) => s.storeyIndex === 2)!;
    for (const g of free.circulation.filter((c) => c.kind === 'gallery'))
      expect(ringBBox(g.polygon.outer).maxY).toBeCloseTo(bb.maxY, 1);
  });

  it('counts a façade standing a little beyond the neighbour boundary as blind', () => {
    const b = rect(10, 30, 50, 40.6); // north façade 0.6 m over the boundary y = 40
    const edges: Seg[] = b.outer.map((p, i) => [p, b.outer[(i + 1) % b.outer.length]!]);
    const party: Seg[] = [
      [
        [0, 40],
        [60, 40],
      ],
    ];
    expect(len(blindFacades(edges, [b], party, 8))).toBeCloseTo(40, 0);
  });

  it('does not take a driveway on a built neighbouring plot for a street', () => {
    const drive: Surroundings = {
      ...surroundings,
      roads: [
        ...surroundings.roads,
        {
          id: 'drive',
          centerline: [
            [-20, 5],
            [-5, 35],
          ],
          width: 3,
          widthEstimated: true,
          kind: 'service',
          level: 0,
          source: 'ign',
        },
        {
          id: 'lane',
          centerline: [
            [5, 48],
            [55, 48],
          ],
          width: 4,
          widthEstimated: true,
          kind: 'residential',
          level: 0,
          source: 'ign',
        },
      ],
    };
    const built = [{ footprint: rect(10, 55, 40, 70) }];
    const segs = classifyBoundary(site, drive, built);
    const west = segs.filter((x) => x.a[0] === 0 && x.b[0] === 0);
    const north = segs.filter((x) => x.a[1] === 40 && x.b[1] === 40);
    expect(west.every((x) => x.kind === 'neighbour')).toBe(true);
    // a street inside a built plot is a private lane
    expect(north.every((x) => x.kind === 'neighbour')).toBe(true);
    // the same lane in an empty parcel is a road parcel
    expect(classifyBoundary(site, drive).some((x) => x.a[1] === 40 && x.kind === 'road')).toBe(
      true,
    );
  });
});
