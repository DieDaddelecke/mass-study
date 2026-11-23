import type { Project, SolidResult } from '@kubatur/core';
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { OrthographicCamera, Vector3 } from 'three';
import { useViewportStore } from '../viewportStore';
import {
  emptyBox,
  expandBox,
  fitBox,
  isEmptyBox,
  orthoZoomFor,
  planFit,
  SW_ISO_DIR,
  type BBox3,
  type V3,
} from './cameraFit';
import { contextRange } from './geometry';
import { controlsRef } from './controlsRef';

const { ACTION } = CameraControlsImpl;
export const FOV = 40;

/** Bounding box of site + masses (+ context within `contextMargin` m of that box, if given). */
export function modelBox(
  project: Project,
  solids: readonly SolidResult[],
  contextMargin?: number,
): BBox3 {
  const b = emptyBox();
  for (const p of project.site.boundary.outer) expandBox(b, p[0], p[1], 0);
  for (const { solid } of solids)
    for (const p of solid.footprint.outer) {
      expandBox(b, p[0], p[1], solid.z0);
      expandBox(b, p[0], p[1], solid.z1);
    }
  if (contextMargin !== undefined && !isEmptyBox(b)) {
    const core: BBox3 = { min: [...b.min], max: [...b.max] };
    for (const c of project.context) {
      if (c.hidden) continue;
      const [, z1] = contextRange(c);
      for (const p of c.footprint.outer) {
        if (
          p[0] < core.min[0] - contextMargin ||
          p[0] > core.max[0] + contextMargin ||
          p[1] < core.min[1] - contextMargin ||
          p[1] > core.max[1] + contextMargin
        )
          continue;
        expandBox(b, p[0], p[1], z1);
      }
    }
  }
  return b;
}

interface SavedView {
  pos: V3;
  target: V3;
  zoom: number;
}
/** Last 3D view and last plan view (kept across projection / view switches). */
const viewMemo: { current: SavedView | null } = { current: null };
const planMemo: { current: SavedView | null } = { current: null };

interface Props {
  project: Project;
  solids: readonly SolidResult[];
  projection: 'perspective' | 'orthographic';
  /** Editable plan view: straight down, parallel projection, no orbiting. */
  plan?: boolean;
}

export function CameraRig({ project, solids, projection, plan = false }: Props) {
  const ref = useRef<CameraControlsImpl>(null);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controlsEnabled = useViewportStore((s) => s.controlsEnabled);
  const zoomReq = useViewportStore((s) => s.zoomExtentsRequest);
  const homeReq = useViewportStore((s) => s.homeRequest);
  const ortho = plan || projection === 'orthographic';

  const apply = useCallback(
    (fit: { position: V3; target: V3; distance: number }, animate: boolean) => {
      const c = ref.current;
      if (!c) return;
      void c.setLookAt(...fit.position, ...fit.target, animate);
      if (c.camera instanceof OrthographicCamera)
        void c.zoomTo(orthoZoomFor(fit.distance, FOV, size.height), animate);
    },
    [size.height],
  );

  const fit = useCallback(
    (box: BBox3, dir: V3, animate: boolean) =>
      apply(fitBox(box, dir, FOV, size.width / Math.max(1, size.height), 0.85), animate),
    [apply, size.width, size.height],
  );

  const fitPlan = useCallback(
    (box: BBox3, animate: boolean) => {
      const c = ref.current;
      if (!c) return;
      const f = planFit(box, size.width, size.height);
      void c.setLookAt(...f.position, ...f.target, animate);
      void c.zoomTo(f.zoom, animate);
    },
    [size.width, size.height],
  );

  const home = useCallback(
    (animate: boolean) =>
      plan
        ? fitPlan(modelBox(project, solids, 25), animate)
        : fit(modelBox(project, solids, 25), SW_ISO_DIR, animate),
    [fit, fitPlan, plan, project.id],
  );

  // register + initial view (or restore after projection switch)
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    controlsRef.current = c;
    const memo = plan ? planMemo : viewMemo;
    const v = memo.current;
    if (v && plan) {
      void c.setLookAt(...v.pos, ...v.target, false);
      void c.zoomTo(v.zoom, false);
    } else if (v) {
      const d = Math.hypot(v.pos[0] - v.target[0], v.pos[1] - v.target[1], v.pos[2] - v.target[2]);
      apply({ position: v.pos, target: v.target, distance: d }, false);
    } else home(false);
    // immediate camera moves emit no event: request a frame (the canvas draws on demand)
    invalidate();
    return () => {
      const p = c.camera.position;
      const t = c.getTarget(new Vector3());
      memo.current = { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z], zoom: c.camera.zoom };
      if (controlsRef.current === c) controlsRef.current = null;
    };
  }, [ortho, plan]);

  // new project → home
  const firstProject = useRef(project.id);
  useEffect(() => {
    if (firstProject.current === project.id) return;
    firstProject.current = project.id;
    home(true);
  }, [project.id, home]);

  const firstZoom = useRef(zoomReq);
  useEffect(() => {
    if (zoomReq === firstZoom.current) return;
    firstZoom.current = zoomReq;
    const c = ref.current;
    if (!c) return;
    if (plan) return fitPlan(modelBox(project, solids), true);
    const t = c.getTarget(new Vector3());
    const p = c.camera.position;
    fit(modelBox(project, solids), [p.x - t.x, p.y - t.y, p.z - t.z], true);
  }, [zoomReq]);

  const firstHome = useRef(homeReq);
  useEffect(() => {
    if (homeReq === firstHome.current) return;
    firstHome.current = homeReq;
    home(true);
  }, [homeReq, home]);

  // modifier keys: Shift+middle = orbit, Alt+left = orbit (laptops); in plan: pan instead
  const orbit = plan ? ACTION.TRUCK : ACTION.ROTATE;
  useEffect(() => {
    const upd = (e: KeyboardEvent) => {
      const c = ref.current;
      if (!c) return;
      c.mouseButtons.middle = e.shiftKey ? orbit : ACTION.TRUCK;
      c.mouseButtons.left = e.altKey ? orbit : ACTION.NONE;
    };
    window.addEventListener('keydown', upd);
    window.addEventListener('keyup', upd);
    return () => {
      window.removeEventListener('keydown', upd);
      window.removeEventListener('keyup', upd);
    };
  }, [orbit]);

  // pointerdown carries modifier state too (keys pressed outside the window)
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      const c = ref.current;
      if (!c) return;
      c.mouseButtons.middle = e.shiftKey ? orbit : ACTION.TRUCK;
      c.mouseButtons.left = e.altKey ? orbit : ACTION.NONE;
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    return () => el.removeEventListener('pointerdown', onDown, { capture: true });
  }, [gl, orbit]);

  return (
    <>
      <CameraControls
        ref={ref}
        makeDefault
        enabled={controlsEnabled}
        dollyToCursor
        infinityDolly={false}
        minDistance={2}
        azimuthRotateSpeed={plan ? 0 : 1}
        polarRotateSpeed={plan ? 0 : 1}
        maxDistance={8000}
        smoothTime={0.2}
        draggingSmoothTime={0.05}
        mouseButtons={{
          left: ACTION.NONE,
          middle: ACTION.TRUCK,
          right: ACTION.NONE,
          wheel: ortho ? ACTION.ZOOM : ACTION.DOLLY,
        }}
        touches={{
          one: plan ? ACTION.TOUCH_TRUCK : ACTION.TOUCH_ROTATE,
          two: ACTION.TOUCH_DOLLY_TRUCK,
          three: ACTION.TOUCH_TRUCK,
        }}
      />
    </>
  );
}
