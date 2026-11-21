import { zoneTrees, type ContextTree, type PlantingZone } from '@kubatur/core';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Shape,
  ShapeGeometry,
  Path,
  Vector2,
  type BufferGeometry,
} from 'three';
import { useUiStore } from '../../store/uiStore';
import type { ScenePalette } from '../../theme/palette';
import { FatSegments } from './FatSegments';
import { ringSegments } from './geometry';
import { Instances } from './Surroundings';
import { buildTreeInstances } from './treeInstances';

const Z_PLANTING = 0.03;

function zoneGeometry(z: PlantingZone): BufferGeometry | null {
  if (z.polygon.outer.length < 3) return null;
  const s = new Shape(z.polygon.outer.map((p) => new Vector2(p[0], p[1])));
  for (const h of z.polygon.holes ?? [])
    s.holes.push(new Path(h.map((p) => new Vector2(p[0], p[1]))));
  const g = new ShapeGeometry(s);
  g.translate(0, 0, Z_PLANTING);
  return g;
}

/** Trees planted in the zones (as context trees, deterministic). */
export function plantingTrees(zones: readonly PlantingZone[]): ContextTree[] {
  return zones.flatMap((z) => {
    const h = z.treeHeight ?? 8;
    return zoneTrees(z).map((position, i) => ({
      id: `${z.id}#${i}`,
      position,
      height: h,
      crown: Math.max(2, h * 0.6),
      heightEstimated: false,
      source: 'manual' as const,
    }));
  });
}

/** Vegetation zones of the active variant: planted ground, outlines, trees. Pickable. */
export function Plantings({
  zones,
  pal,
  shadows,
}: {
  zones: readonly PlantingZone[];
  pal: ScenePalette;
  shadows: boolean;
}) {
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const geos = useMemo(() => zones.map(zoneGeometry), [zones]);
  useEffect(() => () => geos.forEach((g) => g?.dispose()), [geos]);
  const treeGeos = useMemo(
    () => ({ crown: new IcosahedronGeometry(1, 1), trunk: new CylinderGeometry(1, 1, 1, 5) }),
    [],
  );
  useEffect(() => () => Object.values(treeGeos).forEach((g) => g.dispose()), [treeGeos]);
  const inst = useMemo(() => buildTreeInstances(plantingTrees(zones), pal.tree), [zones, pal.tree]);
  const outline = (z: PlantingZone) => {
    const out: number[] = [];
    for (const r of [z.polygon.outer, ...(z.polygon.holes ?? [])])
      ringSegments(r, Z_PLANTING + 0.02, out);
    return out;
  };
  const pick = (id: string) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 4 || useUiStore.getState().tool.kind !== 'select') return;
      e.stopPropagation();
      useUiStore.getState().setSelection([id]);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (useUiStore.getState().hover !== id) useUiStore.getState().setHover(id);
    },
    onPointerOut: () => {
      if (useUiStore.getState().hover === id) useUiStore.getState().setHover(null);
    },
  });
  return (
    <group>
      {zones.map((z, i) => {
        const g = geos[i];
        if (!g) return null;
        const hot = selection.includes(z.id) || hover === z.id;
        return (
          <group key={z.id}>
            <mesh geometry={g} receiveShadow={shadows} renderOrder={-5} {...pick(z.id)}>
              <meshLambertMaterial
                color={z.kind === 'surDalle' ? pal.green : pal.tree}
                transparent
                opacity={z.kind === 'surDalle' ? 0.75 : 0.9}
                depthWrite={false}
                side={DoubleSide}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
            <FatSegments
              segments={outline(z)}
              color={hot ? '#1e6fd9' : pal.tree}
              width={hot ? 3 : 1.5}
            />
          </group>
        );
      })}
      <Instances
        set={inst.broad}
        geometry={treeGeos.crown}
        color={pal.tree}
        tinted
        shadows={shadows}
      />
      <Instances
        set={inst.trunks}
        geometry={treeGeos.trunk}
        color={pal.contextEdge}
        tinted={false}
        shadows={shadows}
      />
    </group>
  );
}
