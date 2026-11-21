import {
  createMass,
  massFootprints,
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
  pointAtLength,
  rotateAbout,
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
import { collectSnapGeometry, dist, snapPoint, type SnapResult } from './snap';

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
    <Html position={at} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 10]}>
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

interface DrawState {
  pts: Vec2[];
  snap: SnapResult | null;
  typed: string;
  tol: number;
}

function ActiveTool({ kind }: { kind: ActiveKind }) {
  const { t } = useTranslation('tools');
  const { camera, gl } = useThree();
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const st = useRef<DrawState>({ pts: [], snap: null, typed: '', tol: 1 });
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
    if (tl.kind === 'place') {
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
    if (tl.kind === 'place') {
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
        actions.updateMasses(ids, (m) => {
          m.position = [m.position[0] + d[0], m.position[1] + d[1]];
        });
      } else if (tl.kind === 'copy') {
        const cs = sel.map((m) => {
          const c = cloneMass(m, t('copySuffix'));
          c.position = [m.position[0] + d[0], m.position[1] + d[1]];
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
    const onMove = (e: PointerEvent) => {
      const raw = groundFromClient(e.clientX, e.clientY, dom, camera, rc);
      if (!raw) return;
      const s = st.current;
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
        if (s.pts.length && tl.kind === 'place') return reset();
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
  if (tl.kind === 'place') {
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
    for (const m of sel) {
      let ms: Pick<Mass, 'position' | 'rotation' | 'typology'>[] = [];
      if (tl.kind === 'move' || tl.kind === 'copy')
        ms = [{ ...m, position: [m.position[0] + d[0], m.position[1] + d[1]] }];
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
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [preview, setPreview] = useState<Mass | null>(null);
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
          const delta =
            s.enabled && s.grid && s.gridSize > 0 ? Math.round(raw / s.gridSize) * s.gridSize : raw;
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
    return m ? <Grips key={m.id} mass={m} /> : null;
  }
  if (needsSelection || !IMPLEMENTED_TOOLS.includes(kind)) return null;
  const key = tool.kind === 'place' ? `place-${tool.typology.kind}-${tool.template ?? ''}` : kind;
  return <ActiveTool key={key} kind={kind} />;
}
