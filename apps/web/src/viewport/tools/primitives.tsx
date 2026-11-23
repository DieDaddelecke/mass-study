import type { Mass, Polygon, Project, Vec2 } from '@kubatur/core';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Group,
  type OrthographicCamera,
  type PerspectiveCamera,
} from 'three';
import { activeVariant, useProjectStore } from '../../store/projectStore';
import { labelLayerRef } from '../scene/controlsRef';
import type { Segment } from './snap';

/** Shared drawing primitives and camera helpers of the modelling tools. */

export const ACCENT = '#1e6fd9';
export const GHOST = '#e07b00';
export const SNAP_PX = 10;
export const CLICK_PX = 5;
export const GROUND = new Plane(new Vector3(0, 0, 1), 0);

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

export function rayFromClient(
  x: number,
  y: number,
  dom: HTMLElement,
  camera: Camera,
  rc: Raycaster,
) {
  const r = dom.getBoundingClientRect();
  rc.setFromCamera(
    new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1),
    camera,
  );
  return rc.ray;
}

export function groundFromClient(
  x: number,
  y: number,
  dom: HTMLElement,
  camera: Camera,
  rc: Raycaster,
): Vec2 | null {
  const v = new Vector3();
  return rayFromClient(x, y, dom, camera, rc).intersectPlane(GROUND, v) ? [v.x, v.y] : null;
}

/** Size of one screen pixel in model units at `p`. */
export function worldPerPixel(camera: Camera, p: Vector3, heightPx: number): number {
  const o = camera as OrthographicCamera;
  if (o.isOrthographicCamera) return (o.top - o.bottom) / o.zoom / Math.max(1, heightPx);
  const pc = camera as PerspectiveCamera;
  const d = camera.position.distanceTo(p);
  return (d * 2 * Math.tan(((pc.fov ?? 50) * Math.PI) / 360)) / Math.max(1, heightPx);
}

/** Children are drawn in "pixel units" × px (screen-constant size). */
export function ScreenScaled({
  position,
  px,
  children,
}: {
  position: [number, number, number];
  px: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  const { camera, size } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (g) g.scale.setScalar(worldPerPixel(camera, g.position, size.height) * px);
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function useProjectMasses(): { project: Project | null; masses: Mass[] } {
  const project = useProjectStore((s) => s.project);
  return useMemo(
    () => ({ project, masses: project ? activeVariant(project).masses : [] }),
    [project],
  );
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

export function Outline({ poly, color, z = 0.05 }: { poly: Polygon; color: string; z?: number }) {
  const rings = [poly.outer, ...(poly.holes ?? [])];
  return (
    <>
      {rings.map((r, i) =>
        r.length >= 2 ? (
          <Line
            key={i}
            points={[...r, r[0]!].map((p) => [p[0], p[1], z] as [number, number, number])}
            color={color}
            lineWidth={2}
            depthTest={false}
            renderOrder={10}
          />
        ) : null,
      )}
    </>
  );
}

export function Label({ at, text }: { at: [number, number, number]; text: string }) {
  return (
    <Html
      portal={labelLayerRef as React.RefObject<HTMLElement>}
      position={at}
      center
      style={{ pointerEvents: 'none' }}
      zIndexRange={[20, 10]}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.92)',
          color: '#111',
          border: `1px solid ${ACCENT}`,
          borderRadius: 3,
          padding: '1px 5px',
          font: '11px system-ui, sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </Html>
  );
}

export function Guides({ guides }: { guides: readonly Segment[] }) {
  return (
    <>
      {guides.map((g, i) => {
        // extend the guide a little beyond the target edge
        const dx = g[1][0] - g[0][0];
        const dy = g[1][1] - g[0][1];
        const l = Math.hypot(dx, dy) || 1;
        const e = 6 / l;
        return (
          <Line
            key={i}
            points={[
              [g[0][0] - dx * e, g[0][1] - dy * e, 0.09],
              [g[1][0] + dx * e, g[1][1] + dy * e, 0.09],
            ]}
            color="#d6336c"
            lineWidth={1.5}
            dashed
            dashSize={0.8}
            gapSize={0.4}
            depthTest={false}
            renderOrder={12}
          />
        );
      })}
    </>
  );
}
