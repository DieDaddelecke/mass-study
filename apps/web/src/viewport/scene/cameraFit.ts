/** Camera-fit math (pure). */
export type V3 = [number, number, number];

export interface BBox3 {
  min: V3;
  max: V3;
}

export interface FitResult {
  target: V3;
  position: V3;
  distance: number;
}

/** South-west isometric-ish view direction (from target towards the camera). */
export const SW_ISO_DIR: V3 = [-1, -1, 0.9];

export function emptyBox(): BBox3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function expandBox(b: BBox3, x: number, y: number, z: number): BBox3 {
  b.min = [Math.min(b.min[0], x), Math.min(b.min[1], y), Math.min(b.min[2], z)];
  b.max = [Math.max(b.max[0], x), Math.max(b.max[1], y), Math.max(b.max[2], z)];
  return b;
}

export function isEmptyBox(b: BBox3): boolean {
  return !(b.max[0] >= b.min[0] && b.max[1] >= b.min[1] && b.max[2] >= b.min[2]);
}

/**
 * Fit a bounding box: target = centre, distance so the bounding sphere fits the smaller of the
 * vertical / horizontal field of view (perspective), times `margin`.
 */
export function fitBox(
  box: BBox3,
  dir: V3 = SW_ISO_DIR,
  fovDeg = 45,
  aspect = 16 / 9,
  margin = 1.05,
): FitResult {
  const b = isEmptyBox(box) ? { min: [-10, -10, 0] as V3, max: [10, 10, 10] as V3 } : box;
  const target: V3 = [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
  const radius = Math.max(
    1,
    Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2,
  );
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fov = Math.min(vfov, hfov);
  const distance = (radius / Math.sin(fov / 2)) * margin;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const position: V3 = [
    target[0] + (dir[0] / len) * distance,
    target[1] + (dir[1] / len) * distance,
    target[2] + (dir[2] / len) * distance,
  ];
  return { target, position, distance };
}

/** Orthographic zoom (pixels per metre) equivalent to a perspective view at `distance`. */
export function orthoZoomFor(distance: number, fovDeg: number, viewportHeightPx: number): number {
  const h = 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
  return viewportHeightPx / Math.max(h, 1e-6);
}

/**
 * Nav cube hit → view direction. `p` is the hit point in cube-local coords (cube size 1,
 * centred). Components within `band` of a face become ±1 (face / edge / corner), others 0.
 */
export function cubeRegion(p: V3, band = 0.17): V3 {
  const r = (c: number): number => (c > 0.5 - band ? 1 : c < -(0.5 - band) ? -1 : 0);
  return [r(p[0]), r(p[1]), r(p[2])];
}

/** Height of the plan camera above the target (parallel projection: only the depth range). */
export const PLAN_HEIGHT = 1000;

/**
 * Plan view (2D): camera straight above the centre of `box` (a hair south of it so that north
 * points up on screen), zoom in pixels per metre so the box fills `margin` of the viewport.
 */
export function planFit(
  box: BBox3,
  widthPx: number,
  heightPx: number,
  margin = 0.85,
): { target: V3; position: V3; zoom: number } {
  const b = isEmptyBox(box) ? { min: [-10, -10, 0] as V3, max: [10, 10, 10] as V3 } : box;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const dx = Math.max(1, b.max[0] - b.min[0]);
  const dy = Math.max(1, b.max[1] - b.min[1]);
  const zoom = Math.min((widthPx * margin) / dx, (heightPx * margin) / dy);
  return {
    target: [cx, cy, 0],
    position: [cx, cy - PLAN_HEIGHT * 1e-4, PLAN_HEIGHT],
    zoom: Math.max(0.05, zoom),
  };
}
