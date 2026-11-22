import {
  createMass,
  DEFAULT_TREE_SPACING,
  massFootprints,
  normalizePolygon,
  polygonArea,
  newId,
  storeyLabel,
  TEMPLATES,
  toWorld,
  typologySegments,
  type Mass,
  type Polygon,
  type Project,
  type Typology,
  type Vec2,
} from '@kubatur/core';
import { Billboard, Html, Line } from '@react-three/drei';
import { labelLayerRef } from '../scene/controlsRef';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
import { activeVariant, actions, useProjectStore } from '../../store/projectStore';
import type { ToolState } from '../../store/tools';
import { useUiStore } from '../../store/uiStore';
import { useViewportStore } from '../viewportStore';
import { IMPLEMENTED_TOOLS } from './capabilities';
import {
  angleOf,
  applySideGrip,
  freeLinePlacement,
  freePolygonPlacement,
  gripWorldDir,
  heightGripCount,
  isClosingClick,
  isRepeatClick,
  mirrorMass,
  moveVertex,
  add,
  pointAtLength,
  rotateAbout,
  sideSegment,
  selectionCentroid,
  sideGrips,
  stackTop,
  sub,
  toWorldPoint,
  twoClickPlacement,
  vertexGrips,
  type Placement,
  type SideGrip,
} from './math';
import { alignFacade, alignVolume, pickableEdges, pickEdge, type PickableEdge } from './align';
import { facadeMagnet, magnetSnap } from './magnet';
import {
  collectSnapGeometry,
  dist,
  snapPoint,
  type Segment,
  type SnapGeometry,
  type SnapResult,
} from './snap';

const ACCENT = '#1e6fd9';
const GHOST = '#e07b00';
const SNAP_PX = 10;
const CLICK_PX = 5;
const GROUND = new Plane(new Vector3(0, 0, 1), 0);

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

function rayFromClient(x: number, y: number, dom: HTMLElement, camera: Camera, rc: Raycaster) {
  const r = dom.getBoundingClientRect();
  rc.setFromCamera(
    new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1),
    camera,
  );
  return rc.ray;
}

function groundFromClient(
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
function worldPerPixel(camera: Camera, p: Vector3, heightPx: number): number {
  const o = camera as OrthographicCamera;
  if (o.isOrthographicCamera) return (o.top - o.bottom) / o.zoom / Math.max(1, heightPx);
  const pc = camera as PerspectiveCamera;
  const d = camera.position.distanceTo(p);
  return (d * 2 * Math.tan(((pc.fov ?? 50) * Math.PI) / 360)) / Math.max(1, heightPx);
}

/** Children are drawn in "pixel units" × px (screen-constant size). */
function ScreenScaled({
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

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

function useProjectMasses(): { project: Project | null; masses: Mass[] } {
  const project = useProjectStore((s) => s.project);
  return useMemo(
    () => ({ project, masses: project ? activeVariant(project).masses : [] }),
    [project],
  );
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function Outline({ poly, color, z = 0.05 }: { poly: Polygon; color: string; z?: number }) {
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

function circlePts(n = 16, r = 0.35): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r, 0];
  });
}

function SnapGlyph({ snap }: { snap: SnapResult }) {
  let pts: [number, number, number][] | null;
  let segments = false;
  switch (snap.kind) {
    case 'endpoint':
      pts = [
        [-0.5, -0.5, 0],
        [0.5, -0.5, 0],
        [0.5, 0.5, 0],
        [-0.5, 0.5, 0],
        [-0.5, -0.5, 0],
      ];
      break;
    case 'midpoint':
      pts = [
        [-0.5, -0.4, 0],
        [0.5, -0.4, 0],
        [0, 0.5, 0],
        [-0.5, -0.4, 0],
      ];
      break;
    case 'edge':
      segments = true;
      pts = [
        [-0.5, -0.5, 0],
        [0.5, 0.5, 0],
        [-0.5, 0.5, 0],
        [0.5, -0.5, 0],
      ];
      break;
    case 'grid':
      pts = circlePts();
      break;
    default:
      pts = null;
  }
  return (
    <>
      {snap.ref && snap.kind !== 'grid' && (
        <Line
          points={snap.ref.map((p) => [p[0], p[1], 0.06] as [number, number, number])}
          color={ACCENT}
          lineWidth={1}
          dashed
          dashSize={0.5}
          gapSize={0.5}
          depthTest={false}
          renderOrder={11}
        />
      )}
      {pts && (
        <ScreenScaled position={[snap.point[0], snap.point[1], 0.08]} px={12}>
          <Billboard>
            <Line
              points={pts}
              segments={segments}
              color={ACCENT}
              lineWidth={2}
              depthTest={false}
              renderOrder={12}
            />
          </Billboard>
        </ScreenScaled>
      )}
    </>
  );
}

function Label({ at, text }: { at: [number, number, number]; text: string }) {
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

function RubberBand({ from, to, typed }: { from: Vec2; to: Vec2; typed: string }) {
  const len = dist(from, to);
  let deg = (angleOf(from, to) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return (
    <>
      <Line
        points={[
          [from[0], from[1], 0.07],
          [to[0], to[1], 0.07],
        ]}
        color={ACCENT}
        lineWidth={1.5}
        depthTest={false}
        renderOrder={11}
      />
      <Label
        at={[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0.1]}
        text={`${typed ? `${typed}▏` : len.toFixed(2)} m · ${deg.toFixed(1)}°`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Active tool
// ---------------------------------------------------------------------------

type ActiveKind = Exclude<ToolState['kind'], 'select'>;

function placementGhost(p: Placement): Polygon[] {
  return typologySegments(p.typology).map((s) => toWorld(p, s.local));
}

function placeTypology(tool: Extract<ToolState, { kind: 'place' }>): Typology {
  return tool.template ? TEMPLATES[tool.template]() : tool.typology;
}

function isPolyDrawing(tool: ToolState): tool is Extract<ToolState, { kind: 'place' }> {
  return (
    tool.kind === 'place' &&
    !tool.template &&
    (tool.typology.kind === 'freeLine' || tool.typology.kind === 'freePolygon')
  );
}

function nextName(masses: readonly Mass[]): string {
  const used = new Set(masses.map((m) => m.name));
  let n = masses.length + 1;
  while (used.has(`V${n}`)) n++;
  return `V${n}`;
}

function cloneMass(m: Mass, suffix: string): Mass {
  const c = structuredClone(m);
  c.id = newId('mass');
  c.name = `${m.name} ${suffix}`;
  return c;
}

/** Adds several masses in one undo step. */
function addMasses(ms: Mass[]) {
  useProjectStore.getState().update((p) => {
    const v = p.variants.find((x) => x.id === p.activeVariantId) ?? p.variants[0];
    v?.masses.push(...ms);
  });
}

/** Result of a magnetic move: translation `d0`, then rotation about `pivot`, then `extra`. */
export interface MagnetMove {
  d0: Vec2;
  rot: number;
  pivot: Vec2;
  extra: Vec2;
  guides: Segment[];
}

/** Magnetic correction of a translation `d` of the masses `sel` (identity when switched off). */
export function magnetMove(
  sel: readonly Mass[],
  d: Vec2,
  targets: readonly Segment[],
  tol: number,
  suspended = false,
  priority: readonly Segment[] = [],
): MagnetMove {
  const s = useUiStore.getState().snap;
  const id: MagnetMove = { d0: d, rot: 0, pivot: [0, 0], extra: [0, 0], guides: [] };
  if (!s.enabled || !s.magnet || suspended || !sel.length) return id;
  const polys = sel.flatMap((m) =>
    massFootprints({ ...m, position: [m.position[0] + d[0], m.position[1] + d[1]] }),
  );
  const c = selectionCentroid(sel);
  const pivot: Vec2 = [c[0] + d[0], c[1] + d[1]];
  const r = magnetSnap(polys, targets, { tol, rotate: true, pivot, priority });
  return { d0: d, rot: r.rotation, pivot: r.pivot ?? pivot, extra: r.delta, guides: r.guides };
}

/** New position / rotation of a mass after a magnetic move. */
export function movedPlacement(
  m: Pick<Mass, 'position' | 'rotation'>,
  mv: MagnetMove,
): { position: Vec2; rotation: number } {
  const p: Vec2 = [m.position[0] + mv.d0[0], m.position[1] + mv.d0[1]];
  const r = mv.rot ? rotateAbout({ position: p, rotation: m.rotation }, mv.pivot, mv.rot) : null;
  const q = r?.position ?? p;
  return {
    position: [q[0] + mv.extra[0], q[1] + mv.extra[1]],
    rotation: r?.rotation ?? m.rotation,
  };
}

function Guides({ guides }: { guides: readonly Segment[] }) {
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

interface DrawState {
  pts: Vec2[];
  snap: SnapResult | null;
  typed: string;
  tol: number;
  alt: boolean;
}

function ActiveTool({ kind }: { kind: ActiveKind }) {
  const { t } = useTranslation('tools');
  const { camera, gl } = useThree();
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const st = useRef<DrawState>({ pts: [], snap: null, typed: '', tol: 1, alt: false });
  const geomRef = useRef<SnapGeometry>({ edges: [], siteEdges: [] });
  const env = useRef({ project, masses });
  env.current = { project, masses };

  const tool = () => useUiStore.getState().tool;
  const selected = (): Mass[] => {
    const sel = useUiStore.getState().selection;
    return env.current.masses.filter((m) => sel.includes(m.id));
  };

  /** Point used for the next click: typed length overrides the cursor distance. */
  const effective = (): Vec2 | null => {
    const s = st.current;
    const cur = s.snap?.point ?? null;
    const last = s.pts[s.pts.length - 1];
    const v = parseFloat(s.typed.replace(',', '.'));
    if (last && cur && s.typed && Number.isFinite(v) && kind !== 'rotate') {
      return pointAtLength(last, cur, v);
    }
    return cur;
  };

  const updateHint = () => {
    const s = st.current;
    const tl = tool();
    const n = s.pts.length;
    let key: string;
    if (tl.kind === 'drawGreen') key = n === 0 ? 'hint.green.first' : 'hint.polygon.next';
    else if (tl.kind === 'place') {
      if (isPolyDrawing(tl))
        key =
          n === 0
            ? 'hint.place.first'
            : tl.typology.kind === 'freeLine'
              ? 'hint.line.next'
              : 'hint.polygon.next';
      else key = n === 0 ? 'hint.place.first' : 'hint.place.direction';
    } else key = `hint.${tl.kind}.${n === 0 ? 'first' : 'second'}`;
    useUiStore
      .getState()
      .setHint(t(key) + (s.typed ? ` — ${t('hint.typed', { value: s.typed })}` : ''));
  };

  const reset = () => {
    st.current.pts = [];
    st.current.typed = '';
    updateHint();
    bump();
  };

  const finishPoly = (closed: boolean) => {
    const tl = tool();
    const s = st.current;
    if (tl.kind === 'drawGreen') {
      if (s.pts.length < 3) return;
      const polygon = normalizePolygon({ outer: [...s.pts] });
      if (polygonArea(polygon) < 0.5) return;
      const zones = env.current.project ? (activeVariant(env.current.project).plantings ?? []) : [];
      const id = newId('green');
      actions.addPlanting({
        id,
        name: `${t('greenPrefix')} ${zones.length + 1}`,
        kind: tl.plantingKind,
        polygon,
        ...(DEFAULT_TREE_SPACING[tl.plantingKind]
          ? { treeSpacing: DEFAULT_TREE_SPACING[tl.plantingKind], treeHeight: 10 }
          : {}),
      });
      useUiStore.getState().setSelection([id]);
      reset();
      return;
    }
    if (tl.kind !== 'place') return;
    const isLine = tl.typology.kind === 'freeLine';
    if (isLine ? s.pts.length < 2 : s.pts.length < 3) return;
    const pl = isLine ? freeLinePlacement(s.pts, closed, tl.typology) : freePolygonPlacement(s.pts);
    commitPlacement(pl);
  };

  const commitPlacement = (pl: Placement) => {
    const tl = tool();
    if (tl.kind !== 'place') return;
    const m = createMass(pl.typology.kind, {
      position: pl.position,
      rotation: pl.rotation,
      usage: tl.usage,
      name: nextName(env.current.masses),
    });
    m.typology = pl.typology;
    actions.addMass(m);
    useUiStore.getState().setSelection([m.id]);
    reset();
  };

  const click = (p: Vec2) => {
    const tl = tool();
    const s = st.current;
    s.typed = '';
    if (tl.kind === 'drawGreen') {
      if (isClosingClick(s.pts, p, s.tol)) return finishPoly(true);
      if (isRepeatClick(s.pts, p, Math.min(s.tol, 0.05))) return finishPoly(true);
      s.pts.push(p);
    } else if (tl.kind === 'place') {
      if (isPolyDrawing(tl)) {
        if (isClosingClick(s.pts, p, s.tol)) return finishPoly(true);
        if (isRepeatClick(s.pts, p, Math.min(s.tol, 0.05)))
          return finishPoly(tl.typology.kind === 'freePolygon');
        s.pts.push(p);
      } else if (s.pts.length === 0) s.pts.push(p);
      else return commitPlacement(twoClickPlacement(placeTypology(tl), s.pts[0]!, p));
    } else if (s.pts.length === 0) {
      s.pts.push(p);
    } else {
      const a = s.pts[0]!;
      const sel = selected();
      const ids = sel.map((m) => m.id);
      const d = sub(p, a);
      if (tl.kind === 'move') {
        const mv = magnetMove(
          sel,
          d,
          geomRef.current.edges,
          s.tol * 1.2,
          s.alt,
          geomRef.current.siteEdges,
        );
        actions.updateMasses(ids, (m) => {
          const r = movedPlacement(m, mv);
          m.position = r.position;
          m.rotation = r.rotation;
        });
      } else if (tl.kind === 'copy') {
        const mv = magnetMove(
          sel,
          d,
          geomRef.current.edges,
          s.tol * 1.2,
          s.alt,
          geomRef.current.siteEdges,
        );
        const cs = sel.map((m) => {
          const c = cloneMass(m, t('copySuffix'));
          const r = movedPlacement(m, mv);
          c.position = r.position;
          c.rotation = r.rotation;
          return c;
        });
        addMasses(cs);
        useUiStore.getState().setSelection(cs.map((c) => c.id));
      } else if (tl.kind === 'array') {
        const cs: Mass[] = [];
        for (let i = 1; i < Math.max(2, tl.count); i++)
          for (const m of sel) {
            const c = cloneMass(m, `(${i + 1})`);
            c.position = [m.position[0] + d[0] * i, m.position[1] + d[1] * i];
            cs.push(c);
          }
        addMasses(cs);
      } else if (tl.kind === 'rotate') {
        const c = selectionCentroid(sel);
        const ang = angleOf(c, p) - angleOf(c, a);
        rotateSelection(ids, c, ang);
      } else if (tl.kind === 'mirror') {
        if (dist(a, p) < 1e-6) return;
        const byId = new Map(sel.map((m) => [m.id, mirrorMass(m, a, p)]));
        actions.updateMasses(ids, (m) => {
          const r = byId.get(m.id);
          if (!r) return;
          m.position = r.position;
          m.rotation = r.rotation;
          m.typology = r.typology;
        });
      }
      return reset();
    }
    updateHint();
    bump();
  };

  const rotateSelection = (ids: string[], c: Vec2, ang: number) => {
    const sel = selected();
    const byId = new Map(sel.map((m) => [m.id, rotateAbout(m, c, ang)]));
    actions.updateMasses(ids, (m) => {
      const r = byId.get(m.id);
      if (r) {
        m.position = r.position;
        m.rotation = r.rotation;
      }
    });
    reset();
  };

  // pointer + keyboard
  useEffect(() => {
    const dom = gl.domElement;
    let down: [number, number] | null = null;
    const geomFor = () => {
      const { project: p, masses: ms } = env.current;
      if (!p) return { edges: [], siteEdges: [] };
      const tl = tool();
      const exclude =
        tl.kind === 'move' || tl.kind === 'rotate' ? useUiStore.getState().selection : [];
      return collectSnapGeometry(p, ms, exclude);
    };
    let geom = geomFor();
    geomRef.current = geom;
    const onMove = (e: PointerEvent) => {
      const raw = groundFromClient(e.clientX, e.clientY, dom, camera, rc);
      if (!raw) return;
      const s = st.current;
      s.alt = e.altKey;
      s.tol = worldPerPixel(camera, new Vector3(raw[0], raw[1], 0), dom.clientHeight) * SNAP_PX;
      const prev = s.pts[s.pts.length - 1] ?? null;
      const g = { ...geom, points: s.pts };
      s.snap = snapPoint(
        raw,
        g,
        useUiStore.getState().snap,
        s.tol,
        kind === 'rotate' ? null : prev,
      );
      if (kind === 'rotate' && s.pts.length && useUiStore.getState().snap.angle) {
        // angle snapping of the rotation itself, around the centroid
        const c = selectionCentroid(selected());
        const step = (useUiStore.getState().snap.angleStep * Math.PI) / 180;
        const a0 = angleOf(c, s.pts[0]!);
        const da = Math.round((angleOf(c, raw) - a0) / step) * step;
        const r = dist(c, raw);
        s.snap = {
          point: [c[0] + Math.cos(a0 + da) * r, c[1] + Math.sin(a0 + da) * r],
          kind: 'angle',
        };
      }
      useUiStore.getState().setCursor(s.snap.point);
      bump();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) {
        down = [e.clientX, e.clientY];
        geom = geomFor();
        geomRef.current = geom;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > CLICK_PX) return;
      onMove(e);
      const p = effective();
      if (p) click(p);
    };
    const onLeave = () => {
      st.current.snap = null;
      useUiStore.getState().setCursor(null);
      bump();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = st.current;
      const tl = tool();
      if (e.key === 'Escape') {
        if (s.pts.length && (tl.kind === 'place' || tl.kind === 'drawGreen')) return reset();
        useUiStore.getState().setTool({ kind: 'select' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (s.typed && s.pts.length) {
          const v = parseFloat(s.typed.replace(',', '.'));
          if (kind === 'rotate' && Number.isFinite(v)) {
            const sel = selected();
            return rotateSelection(
              sel.map((m) => m.id),
              selectionCentroid(sel),
              (v * Math.PI) / 180,
            );
          }
          const p = effective();
          if (p) click(p);
          return;
        }
        if (isPolyDrawing(tl)) finishPoly(tl.typology.kind === 'freePolygon');
        if (tl.kind === 'drawGreen') finishPoly(true);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (s.typed) s.typed = s.typed.slice(0, -1);
        else s.pts.pop();
        updateHint();
        bump();
        return;
      }
      if (s.pts.length && /^[0-9.,-]$/.test(e.key)) {
        s.typed += e.key;
        updateHint();
        bump();
      }
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    updateHint();
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      useUiStore.getState().setCursor(null);
    };
  }, [kind, camera, gl]);

  // ---- render
  const s = st.current;
  const tl = useUiStore((x) => x.tool);
  const cur = effective();
  const last = s.pts[s.pts.length - 1];
  const ghosts: Polygon[] = [];
  const extraLines: Vec2[][] = [];
  let guides: Segment[] = [];
  if (tl.kind === 'drawGreen') {
    const pts = cur ? [...s.pts, cur] : s.pts;
    if (pts.length >= 3) ghosts.push({ outer: pts });
    if (pts.length >= 2) extraLines.push(pts);
  } else if (tl.kind === 'place') {
    if (isPolyDrawing(tl)) {
      const pts = cur ? [...s.pts, cur] : s.pts;
      if (pts.length >= 2) {
        if (tl.typology.kind === 'freeLine') {
          const pl = freeLinePlacement(pts, false, tl.typology);
          ghosts.push(...placementGhost(pl));
        } else if (pts.length >= 3) ghosts.push(...placementGhost(freePolygonPlacement(pts)));
        extraLines.push(pts);
      }
    } else if (cur) {
      ghosts.push(
        ...placementGhost(
          twoClickPlacement(placeTypology(tl), s.pts[0] ?? cur, s.pts[0] ? cur : null),
        ),
      );
    }
  } else if (s.pts.length && cur) {
    const sel = selected();
    const a = s.pts[0]!;
    const d = sub(cur, a);
    const mv =
      tl.kind === 'move' || tl.kind === 'copy'
        ? magnetMove(sel, d, geomRef.current.edges, s.tol * 1.2, s.alt, geomRef.current.siteEdges)
        : null;
    if (mv) guides = mv.guides;
    for (const m of sel) {
      let ms: Pick<Mass, 'position' | 'rotation' | 'typology'>[] = [];
      if (mv) ms = [{ ...m, ...movedPlacement(m, mv) }];
      else if (tl.kind === 'array')
        ms = Array.from({ length: Math.max(1, tl.count - 1) }, (_, i) => ({
          ...m,
          position: [m.position[0] + d[0] * (i + 1), m.position[1] + d[1] * (i + 1)] as Vec2,
        }));
      else if (tl.kind === 'rotate') {
        const c = selectionCentroid(sel);
        ms = [{ ...m, ...rotateAbout(m, c, angleOf(c, cur) - angleOf(c, a)) }];
      } else if (tl.kind === 'mirror' && dist(a, cur) > 1e-6)
        ms = [{ ...m, ...mirrorMass(m, a, cur) }];
      for (const x of ms) ghosts.push(...massFootprints({ ...m, ...x }));
    }
  }
  const rotC = tl.kind === 'rotate' ? selectionCentroid(selected()) : null;
  let rotLabel: string | null = null;
  if (rotC && s.pts[0] && cur) {
    let deg = ((angleOf(rotC, cur) - angleOf(rotC, s.pts[0])) * 180) / Math.PI;
    deg = ((deg + 540) % 360) - 180;
    rotLabel = s.typed ? `${s.typed}▏°` : `${deg.toFixed(1)}°`;
  }

  return (
    <group>
      {ghosts.map((g, i) => (
        <Outline key={i} poly={g} color={GHOST} />
      ))}
      {extraLines.map((l, i) => (
        <Line
          key={`l${i}`}
          points={l.map((p) => [p[0], p[1], 0.06] as [number, number, number])}
          color={ACCENT}
          lineWidth={1}
          dashed
          dashSize={1}
          gapSize={0.5}
          depthTest={false}
          renderOrder={10}
        />
      ))}
      <Guides guides={guides} />
      {s.snap && (
        <SnapGlyph snap={cur && cur !== s.snap.point ? { point: cur, kind: 'none' } : s.snap} />
      )}
      {rotC && (
        <>
          {s.pts[0] && (
            <Line
              points={[
                [rotC[0], rotC[1], 0.07],
                [s.pts[0][0], s.pts[0][1], 0.07],
              ]}
              color={ACCENT}
              lineWidth={1}
              depthTest={false}
            />
          )}
          {cur && (
            <Line
              points={[
                [rotC[0], rotC[1], 0.07],
                [cur[0], cur[1], 0.07],
              ]}
              color={ACCENT}
              lineWidth={1.5}
              depthTest={false}
            />
          )}
          {rotLabel && cur && <Label at={[cur[0], cur[1], 0.1]} text={rotLabel} />}
        </>
      )}
      {!rotC && last && cur && <RubberBand from={last} to={cur} typed={s.typed} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Grips
// ---------------------------------------------------------------------------

const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();

type GripDrag =
  { type: 'side'; grip: SideGrip } | { type: 'vertex'; index: number } | { type: 'height' };

function Grips({ mass }: { mass: Mass }) {
  const { camera, gl } = useThree();
  // plan view: the height grip would point at the camera (storeys: inspector or 3D)
  const plan = useUiStore((st) => st.activeView === 'plan');
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [preview, setPreview] = useState<Mass | null>(null);
  const [guides, setGuides] = useState<Segment[]>([]);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const m = preview ?? mass;
  const top = stackTop(m.storeys);
  const fps = massFootprints(m);
  const centre = selectionCentroid([m]);
  const notation = project?.settings.notation ?? 'fr';

  const begin = (e: ThreeEvent<PointerEvent>, drag: GripDrag) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const dom = gl.domElement;
    const vs = useViewportStore.getState();
    vs.setControlsEnabled(false);
    const start = mass;
    const startGround = groundFromClient(e.clientX, e.clientY, dom, camera, rc);
    // vertical plane through the grip, facing the camera
    const n = new Vector3().subVectors(camera.position, new Vector3(centre[0], centre[1], top));
    n.z = 0;
    if (n.lengthSq() < 1e-9) n.set(0, 1, 0);
    n.normalize();
    const vplane = new Plane().setFromNormalAndCoplanarPoint(
      n,
      new Vector3(centre[0], centre[1], top),
    );
    const zAt = (x: number, y: number) => {
      const v = new Vector3();
      return rayFromClient(x, y, dom, camera, rc).intersectPlane(vplane, v) ? v.z : null;
    };
    const startZ = zAt(e.clientX, e.clientY);
    const geom = project ? collectSnapGeometry(project, masses, [mass.id]) : null;
    let current: Mass | null = null;

    const onMove = (ev: PointerEvent) => {
      let next: Mass;
      if (drag.type === 'height') {
        const z = zAt(ev.clientX, ev.clientY);
        if (z === null || startZ === null) return;
        const count = heightGripCount(
          start.storeys.upper.count,
          z - startZ,
          start.storeys.upper.height,
        );
        next = {
          ...start,
          storeys: { ...start.storeys, upper: { ...start.storeys.upper, count } },
        };
      } else {
        const p = groundFromClient(ev.clientX, ev.clientY, dom, camera, rc);
        if (!p || !startGround) return;
        if (drag.type === 'side') {
          const dir = gripWorldDir(start, drag.grip);
          const raw = (p[0] - startGround[0]) * dir[0] + (p[1] - startGround[1]) * dir[1];
          const s = useUiStore.getState().snap;
          let delta =
            s.enabled && s.grid && s.gridSize > 0 ? Math.round(raw / s.gridSize) * s.gridSize : raw;
          let guide: Segment | null = null;
          const seg0 = sideSegment(start, drag.grip);
          if (s.enabled && s.magnet && !ev.altKey && geom && seg0) {
            const tol =
              worldPerPixel(camera, new Vector3(p[0], p[1], 0), dom.clientHeight) * SNAP_PX * 1.2;
            const moved: Segment = [
              [seg0[0][0] + dir[0] * raw, seg0[0][1] + dir[1] * raw],
              [seg0[1][0] + dir[0] * raw, seg0[1][1] + dir[1] * raw],
            ];
            const f = facadeMagnet(moved, dir, geom.edges, tol);
            if (f) {
              delta = raw + f.offset;
              guide = f.guide;
            }
          }
          setGuides(guide ? [guide] : []);
          next = { ...start, ...applySideGrip(start, drag.grip, delta) };
        } else {
          const tol = worldPerPixel(camera, new Vector3(p[0], p[1], 0), dom.clientHeight) * SNAP_PX;
          const sp = geom ? snapPoint(p, geom, useUiStore.getState().snap, tol).point : p;
          next = { ...start, typology: moveVertex(start, drag.index, sp) };
        }
        useUiStore.getState().setCursor(p);
      }
      current = next;
      setPreview(next);
    };
    const end = (commit: boolean) => {
      cleanup.current?.();
      cleanup.current = null;
      const c = current;
      if (commit && c) {
        actions.updateMass(start.id, (d) => {
          d.position = c.position;
          d.typology = c.typology;
          d.storeys.upper.count = c.storeys.upper.count;
        });
      }
      setPreview(null);
      setGuides([]);
    };
    const onUp = () => end(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') end(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      useViewportStore.getState().setControlsEnabled(true);
    };
  };

  const handle = { onClick: stop, onDoubleClick: stop, onPointerUp: stop };
  return (
    <group>
      {preview && fps.map((f, i) => <Outline key={i} poly={f} color={GHOST} z={0.1} />)}
      <Guides guides={guides} />
      {sideGrips(m.typology).map(({ grip, local, dir }) => {
        const w = toWorldPoint(m, local);
        const wd = gripWorldDir(m, grip);
        const ang = Math.atan2(wd[1], wd[0]);
        void dir;
        return (
          <ScreenScaled key={`${grip.axis}${grip.sign}`} position={[w[0], w[1], 0.3]} px={14}>
            <group rotation={[0, 0, ang - Math.PI / 2]}>
              <mesh
                position={[0, 0.8, 0]}
                renderOrder={20}
                onPointerDown={(e) => begin(e, { type: 'side', grip })}
                {...handle}
              >
                <coneGeometry args={[0.6, 1.2, 3]} />
                <meshBasicMaterial color={ACCENT} depthTest={false} />
              </mesh>
            </group>
          </ScreenScaled>
        );
      })}
      {vertexGrips(m.typology).map((lp, i) => {
        const w = toWorldPoint(m, lp);
        return (
          <ScreenScaled key={`v${i}`} position={[w[0], w[1], 0.2]} px={10}>
            <mesh
              renderOrder={20}
              onPointerDown={(e) => begin(e, { type: 'vertex', index: i })}
              {...handle}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={ACCENT} depthTest={false} />
            </mesh>
          </ScreenScaled>
        );
      })}
      {!plan && (
        <ScreenScaled position={[centre[0], centre[1], top]} px={14}>
          <mesh
            position={[0, 0, 1.2]}
            rotation={[Math.PI / 2, 0, 0]}
            renderOrder={20}
            onPointerDown={(e) => begin(e, { type: 'height' })}
            {...handle}
          >
            <coneGeometry args={[0.6, 1.4, 12]} />
            <meshBasicMaterial color={ACCENT} depthTest={false} />
          </mesh>
        </ScreenScaled>
      )}
      {preview && preview.storeys.upper.count !== mass.storeys.upper.count && (
        <Label
          at={[centre[0], centre[1], top + 2]}
          text={storeyLabel(preview.storeys.upper.count, notation, false)}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Align (AL): reference edge, then façade
// ---------------------------------------------------------------------------

function EdgeHighlight({ e, color }: { e: PickableEdge; color: string }) {
  const [a, b] = e.seg;
  const z0 = e.z0 + 0.06;
  const z1 = Math.max(e.z1, e.z0) + 0.06;
  const pts: [number, number, number][] =
    e.z1 - e.z0 > 0.1
      ? [
          [a[0], a[1], z0],
          [b[0], b[1], z0],
          [b[0], b[1], z1],
          [a[0], a[1], z1],
          [a[0], a[1], z0],
        ]
      : [
          [a[0], a[1], z0],
          [b[0], b[1], z0],
        ];
  return <Line points={pts} color={color} lineWidth={3.5} depthTest={false} renderOrder={13} />;
}

function AlignTool() {
  const { t } = useTranslation('tools');
  const { camera, gl } = useThree();
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [ref, setRef] = useState<PickableEdge | null>(null);
  const [hover, setHover] = useState<PickableEdge | null>(null);
  const env = useRef({ project, masses, ref });
  env.current = { project, masses, ref };

  useEffect(() => {
    const ui = useUiStore.getState();
    const tl = ui.tool;
    const mode = tl.kind === 'align' ? (tl.mode ?? 'facade') : 'facade';
    ui.setHint(t(ref ? `hint.align.${mode}` : 'hint.align.first'));
  }, [ref, t]);

  useEffect(() => {
    const dom = gl.domElement;
    let down: [number, number] | null = null;
    const pick = (x: number, y: number): PickableEdge | null => {
      const { project: p, masses: ms, ref: r } = env.current;
      if (!p) return null;
      const ray = rayFromClient(x, y, dom, camera, rc);
      const g = new Vector3();
      const gp = ray.intersectPlane(GROUND, g) ? g : ray.origin;
      const tol = worldPerPixel(camera, gp, dom.clientHeight) * SNAP_PX;
      let edges = pickableEdges(p, ms);
      if (r) edges = edges.filter((e) => e.kind === 'mass' && e.seg !== r.seg);
      return pickEdge(
        edges,
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
        tol,
      );
    };
    const onMove = (e: PointerEvent) => setHover(pick(e.clientX, e.clientY));
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > CLICK_PX) return;
      const hit = pick(e.clientX, e.clientY);
      if (!hit) return;
      const { masses: ms, ref: r } = env.current;
      if (!r) {
        setRef(hit);
        return;
      }
      const m = ms.find((x) => x.id === hit.massId);
      if (!m) return;
      const tl = useUiStore.getState().tool;
      const volume = (tl.kind === 'align' && tl.mode === 'volume') || e.shiftKey;
      if (volume) {
        const res = alignVolume(m, hit.seg, r.seg);
        actions.updateMass(m.id, (d) => {
          d.position = res.position;
          d.rotation = res.rotation;
        });
      } else {
        const res = alignFacade(m, hit.seg, r.seg);
        if (!res) {
          useUiStore.getState().setHint(t('hint.align.impossible'));
          return;
        }
        actions.updateMass(m.id, (d) => {
          d.position = res.position;
          d.rotation = res.rotation;
          d.typology = res.typology;
        });
      }
      useUiStore.getState().setSelection([m.id]);
      setRef(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.key !== 'Escape') return;
      if (env.current.ref) setRef(null);
      else useUiStore.getState().setTool({ kind: 'select' });
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [camera, gl, rc, t]);

  return (
    <group>
      {ref && <EdgeHighlight e={ref} color="#d6336c" />}
      {ref && <Guides guides={[ref.seg]} />}
      {hover && <EdgeHighlight e={hover} color={ACCENT} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Direct drag of selected masses (select tool) with magnetic snapping
// ---------------------------------------------------------------------------

let dragStarter: ((e: PointerEvent, id: string) => boolean) | null = null;

/**
 * Called by the scene on pointer-down on a mass. Starts a drag when the mass is selected and the
 * select tool is active; returns true when the drag took over the pointer.
 */
export function startMassDrag(e: PointerEvent, id: string): boolean {
  return dragStarter?.(e, id) ?? false;
}

function MassDrag() {
  const { camera, gl } = useThree();
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const env = useRef({ project, masses });
  env.current = { project, masses };
  const [ghosts, setGhosts] = useState<Polygon[]>([]);
  const [guides, setGuides] = useState<Segment[]>([]);
  const [label, setLabel] = useState<{ at: Vec2; text: string } | null>(null);

  useEffect(() => {
    const dom = gl.domElement;
    let cleanup: (() => void) | null = null;
    dragStarter = (e, id) => {
      const ui = useUiStore.getState();
      if (e.button !== 0 || ui.tool.kind !== 'select' || !ui.selection.includes(id)) return false;
      if (e.ctrlKey || e.shiftKey || e.metaKey) return false;
      const { project: p, masses: ms } = env.current;
      if (!p) return false;
      const start = groundFromClient(e.clientX, e.clientY, dom, camera, rc);
      if (!start) return false;
      const sel = ms.filter((m) => ui.selection.includes(m.id));
      const ids = sel.map((m) => m.id);
      const geom = collectSnapGeometry(p, ms, ids);
      const down: [number, number] = [e.clientX, e.clientY];
      let active = false;
      let mv: MagnetMove | null = null;
      useViewportStore.getState().setControlsEnabled(false);
      const onMove = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < CLICK_PX) return;
        active = true;
        const q = groundFromClient(ev.clientX, ev.clientY, dom, camera, rc);
        if (!q) return;
        const tol = worldPerPixel(camera, new Vector3(q[0], q[1], 0), dom.clientHeight) * SNAP_PX;
        const s = useUiStore.getState().snap;
        let d = sub(q, start);
        if (s.enabled && s.grid && s.gridSize > 0)
          d = [
            Math.round(d[0] / s.gridSize) * s.gridSize,
            Math.round(d[1] / s.gridSize) * s.gridSize,
          ];
        mv = magnetMove(sel, d, geom.edges, tol * 1.2, ev.altKey, geom.siteEdges);
        const cur = mv;
        setGhosts(sel.flatMap((m) => massFootprints({ ...m, ...movedPlacement(m, cur) })));
        setGuides(cur.guides);
        const tot = add(add(cur.d0, cur.extra), [0, 0]);
        setLabel({
          at: q,
          text:
            `${Math.hypot(tot[0], tot[1]).toFixed(2)} m` +
            (cur.rot ? ` · ${((cur.rot * 180) / Math.PI).toFixed(1)}°` : ''),
        });
        useUiStore.getState().setCursor(q);
      };
      const finish = (commit: boolean) => {
        cleanup?.();
        cleanup = null;
        const m = mv;
        if (commit && active && m)
          actions.updateMasses(ids, (x) => {
            const r = movedPlacement(x, m);
            x.position = r.position;
            x.rotation = r.rotation;
          });
        setGhosts([]);
        setGuides([]);
        setLabel(null);
      };
      const onUp = () => finish(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') finish(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
      cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        useViewportStore.getState().setControlsEnabled(true);
        useUiStore.getState().setCursor(null);
      };
      return true;
    };
    return () => {
      dragStarter = null;
      cleanup?.();
    };
  }, [camera, gl, rc]);

  return (
    <group>
      {ghosts.map((g, i) => (
        <Outline key={i} poly={g} color={GHOST} z={0.1} />
      ))}
      <Guides guides={guides} />
      {label && <Label at={[label.at[0], label.at[1], 0.5]} text={label.text} />}
    </group>
  );
}

// ---------------------------------------------------------------------------

const MODIFY: readonly ToolState['kind'][] = ['move', 'copy', 'rotate', 'mirror', 'array'];

/**
 * Rendered by the scene inside the R3F <Canvas>. Handles placement, snapping, move/rotate/copy/
 * mirror/array (pointer input via the canvas DOM element and a ray against z = 0) and grips.
 */
export function ToolLayer() {
  const { t } = useTranslation('tools');
  const tool = useUiStore((s) => s.tool);
  const selection = useUiStore((s) => s.selection);
  const { masses } = useProjectMasses();
  const kind = tool.kind;
  const needsSelection = MODIFY.includes(kind) && selection.length === 0;

  useEffect(() => {
    if (needsSelection) {
      const ui = useUiStore.getState();
      ui.setTool({ kind: 'select' });
      ui.setHint(t('hint.selectFirst'));
    }
  }, [needsSelection, t]);
  useEffect(
    () => () => {
      // leaving a tool: clear its hint (unless we just asked to select first)
      if (kind !== 'select' && useUiStore.getState().hint !== t('hint.selectFirst'))
        useUiStore.getState().setHint('');
    },
    [kind, t],
  );

  if (kind === 'select') {
    const m = selection.length === 1 ? masses.find((x) => x.id === selection[0]) : undefined;
    return (
      <>
        <MassDrag />
        {m && <Grips key={m.id} mass={m} />}
      </>
    );
  }
  if (needsSelection || !IMPLEMENTED_TOOLS.includes(kind)) return null;
  if (kind === 'align') return <AlignTool />;
  const key = tool.kind === 'place' ? `place-${tool.typology.kind}-${tool.template ?? ''}` : kind;
  return <ActiveTool key={key} kind={kind} />;
}
