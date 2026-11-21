import type {
  ContextParcel,
  ContextRoad,
  ContextTree,
  Polygon,
  Surroundings,
  Vec2,
} from '@kubatur/core';

/** Street orientation of the Palaiseau demo site (radians, local frame). */
const ANGLE = -0.13;
const C = Math.cos(ANGLE);
const S = Math.sin(ANGLE);
/** (u along the boulevard, v towards north) → local. */
const P = (u: number, v: number): Vec2 => [u * C - v * S, u * S + v * C];
const rectUV = (u0: number, v0: number, u1: number, v1: number): Polygon => ({
  outer: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
});

/**
 * Plausible synthetic streets, trees, a park and neighbouring parcels around the Palaiseau demo
 * site (≈ 72 × 50 m, centred on the origin). Development only – real recorded data replaces it.
 */
export function syntheticSurroundings(): Surroundings {
  const roads: ContextRoad[] = [];
  const road = (
    id: string,
    pts: [number, number][],
    width: number,
    kind: ContextRoad['kind'],
    name?: string,
  ) =>
    roads.push({
      id,
      centerline: pts.map(([u, v]) => P(u, v)),
      width,
      widthEstimated: true,
      kind,
      name,
      level: 0,
      source: 'manual',
    });
  // D 128 along the south, side street to the west, a minor street to the north
  road(
    'syn-d128',
    [
      [-260, -40],
      [260, -40],
    ],
    9,
    'secondary',
    'D 128',
  );
  road(
    'syn-west',
    [
      [-58, -40],
      [-58, 210],
    ],
    6,
    'residential',
    'Rue de l’Ouest',
  );
  road(
    'syn-north',
    [
      [-58, 95],
      [220, 95],
    ],
    6,
    'residential',
  );
  road(
    'syn-east',
    [
      [110, -40],
      [110, 95],
    ],
    5,
    'service',
  );
  // footways
  for (const v of [-46.5, -33.5])
    road(
      `syn-fw-${v}`,
      [
        [-260, v],
        [260, v],
      ],
      2.5,
      'footway',
    );
  for (const u of [-63.5, -52.5])
    road(
      `syn-fw-w${u}`,
      [
        [u, -33.5],
        [u, 210],
      ],
      2,
      'footway',
    );
  road(
    'syn-path',
    [
      [-52.5, 60],
      [30, 60],
      [60, 80],
      [104, 80],
    ],
    2.2,
    'path',
  );
  road(
    'syn-tram',
    [
      [-260, -72],
      [260, -72],
    ],
    1.4,
    'tram',
  );

  // trees along D128 (both sides) and the west street
  const trees: ContextTree[] = [];
  const tree = (id: string, u: number, v: number, h: number) =>
    trees.push({
      id,
      position: P(u, v),
      height: h,
      crown: h * 0.55,
      heightEstimated: true,
      source: 'manual',
    });
  let i = 0;
  for (let u = -180; u <= 180; u += 14) {
    if (Math.abs(u + 58) < 8) continue;
    tree(`syn-t${i++}`, u, -49.5, 10 + (i % 4));
    if (u > -150 && u < 150 && i % 2 === 0) tree(`syn-t${i++}`, u + 7, -30.5, 8 + (i % 3));
  }
  for (let v = -20; v <= 90; v += 12) tree(`syn-t${i++}`, -66.5, v, 9);
  // park trees, some conifers
  for (let k = 0; k < 10; k++) {
    tree(
      `syn-p${k}`,
      30 + (k % 5) * 14 + (k % 2) * 4,
      70 + Math.floor(k / 5) * 12,
      12 + (k % 3) * 2,
    );
    if (k % 3 === 0) trees[trees.length - 1]!.leafType = 'needleleaved';
  }

  const green = [
    {
      id: 'syn-park',
      footprint: rectUV(20, 50, 105, 90),
      kind: 'park' as const,
      source: 'manual' as const,
    },
    {
      id: 'syn-wood',
      footprint: rectUV(-200, 100, -64, 200),
      kind: 'wood' as const,
      source: 'manual' as const,
    },
    {
      id: 'syn-verge',
      footprint: rectUV(-260, -60, 260, -52),
      kind: 'grass' as const,
      source: 'manual' as const,
    },
    {
      id: 'syn-hedge',
      footprint: rectUV(37.5, -24, 38.3, 24),
      kind: 'hedge' as const,
      source: 'manual' as const,
    },
  ];
  const water = [{ id: 'syn-pond', footprint: rectUV(60, 58, 85, 70), source: 'manual' as const }];

  // neighbouring parcels in the block north of D128 and east of the west street
  const parcels: ContextParcel[] = [];
  const cuts = [-51, -35, 35, 52, 70, 88, 107];
  for (let k = 0; k < cuts.length - 1; k++) {
    if (cuts[k] === -35) continue; // site
    const ref = `0H 05${20 + k}`;
    parcels.push({
      id: `syn-par${k}`,
      ref,
      label: ref.slice(3),
      polygon: rectUV(cuts[k]!, -32, cuts[k + 1]!, 46),
    });
  }
  parcels.push({
    id: 'syn-par-n',
    ref: '0H 0530',
    label: '0530',
    polygon: rectUV(-35, 27, 35, 46),
  });
  for (let k = 0; k < 6; k++) {
    const u0 = -230 + k * 30;
    const ref = `0H 06${10 + k}`;
    parcels.push({
      id: `syn-ps${k}`,
      ref,
      label: ref.slice(3),
      polygon: rectUV(u0, -120, u0 + 30, -78),
    });
  }
  return { roads, green, trees, water, parcels };
}
