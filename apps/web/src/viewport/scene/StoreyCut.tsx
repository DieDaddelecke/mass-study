import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { MassLayout, Polygon, StairRules, StoreySolid, UnitType } from '@kubatur/core';
import { useEffect, useMemo } from 'react';
import type { VisualStyle } from '../../store/tools';
import { buildStoreyCut } from './storeyCut';

interface PickHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
}

/** The cut storey of the "coupe par étage": floor plan in 3D with dwelling labels. */
export function StoreyCut({
  solids,
  layouts,
  level,
  mix,
  wallColor,
  loggias,
  stairRules,
  style,
  shadows,
  pick,
}: {
  solids: readonly { solid: StoreySolid }[];
  layouts: readonly MassLayout[] | null | undefined;
  level: number;
  mix: readonly UnitType[];
  wallColor: string;
  loggias: ReadonlyMap<string, Polygon[]> | undefined;
  stairRules?: StairRules;
  style: VisualStyle;
  shadows: boolean;
  pick: (id: string) => PickHandlers;
}) {
  const scene = useMemo(
    () =>
      buildStoreyCut(
        solids.map((r) => r.solid),
        layouts,
        level,
        mix,
        wallColor,
        loggias,
        stairRules,
      ),
    [solids, layouts, level, mix, wallColor, loggias, stairRules],
  );
  useEffect(() => () => scene.masses.forEach((m) => m.geometry.dispose()), [scene]);
  return (
    <group>
      {scene.masses.map((m) => (
        <mesh
          key={m.massId}
          geometry={m.geometry}
          castShadow={shadows}
          receiveShadow={shadows}
          {...pick(m.massId)}
        >
          {style === 'realistic' ? (
            <meshStandardMaterial vertexColors roughness={0.9} />
          ) : (
            <meshLambertMaterial vertexColors />
          )}
        </mesh>
      ))}
      {scene.labels.map((l, i) => (
        <Html key={i} position={l.at} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`vp-cut-label${l.warn ? ' is-warn' : ''}`}>
            <b>{l.title}</b>
            <span>{l.sub}</span>
          </div>
        </Html>
      ))}
    </group>
  );
}
