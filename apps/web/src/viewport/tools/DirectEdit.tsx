import { massFootprints, storeyLabel, type Mass, type Vec2 } from '@kubatur/core';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DoubleSide, Plane, Raycaster, Vector3, type Camera, type Group, type Mesh } from 'three';
import { actions } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { labelLayerRef } from '../scene/controlsRef';
import { useViewportStore } from '../viewportStore';
import { facadeMagnet } from './magnet';
import {
  angleOf,
  applyFace,
  applySideGrip,
  massFaces,
  moveVertex,
  rotateAbout,
  screenAxisDelta,
  selectionCentroid,
  sideSize,
  stackTop,
  toWorldPoint,
  vertexGrips,
  type Face,
  type SideGrip,
} from './math';
import {
  ACCENT,
  GHOST,
  Guides,
  Outline,
  ScreenScaled,
  SNAP_PX,
  groundFromClient,
  rayFromClient,
  useProjectMasses,
  worldPerPixel,
} from './primitives';
import { collectSnapGeometry, snapPoint, type Segment } from './snap';
import { markCommitted, typedValue, useValueEdit } from './valueEdit';

/**
 * Direct manipulation of the selected volume (select tool):
 * - drag a façade to push / pull it (rectangular typologies and free polygons),
 * - storey pill on the roof: ▲ / ▼ buttons or vertical drag,
 * - rotation handle at a roof corner,
 * - dimension chips on the roof edges (click to type an exact value),
 * - vertex grips for free lines / polygons.
 * Every drag feeds the measurements box (`valueEdit`): typing a number sets the exact value.
 */

const HOVER = '#4f46e5';
const STOREY_PX = 28; // fallback vertical pixels per storey (plan view)

function toScreen(p: Vector3, camera: Camera, w: number, h: number): Vec2 {
  const v = p.clone().project(camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

/** Model displacement along `axis` for a pointer movement, via the axis' screen projection. */
function axisDelta(
  camera: Camera,
  dom: HTMLElement,
  origin: Vector3,
  axis: Vector3,
  dx: number,
  dy: number,
): number | null {
  const w = dom.clientWidth;
  const h = dom.clientHeight;
  return screenAxisDelta(
    toScreen(origin, camera, w, h),
    toScreen(origin.clone().add(axis), camera, w, h),
    [dx, dy],
  );
}

const chipStyle = (active: boolean): CSSProperties => ({
  background: active ? HOVER : 'rgba(255,255,255,0.95)',
  color: active ? '#fff' : '#1e1b4b',
  border: `1.5px solid ${HOVER}`,
  borderRadius: 7,
  padding: '2px 7px',
  font: '600 11.5px Inter, system-ui, sans-serif',
  whiteSpace: 'nowrap',
  boxShadow: '0 2px 8px rgba(0,0,0,.15)',
  userSelect: 'none',
});

function HtmlAt({
  at,
  children,
  interactive = false,
  z = [30, 20],
}: {
  at: [number, number, number];
  children: React.ReactNode;
  interactive?: boolean;
  z?: [number, number];
}) {
  return (
    <Html
      portal={labelLayerRef as React.RefObject<HTMLElement>}
      position={at}
      center
      zIndexRange={z}
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    >
      {children}
    </Html>
  );
}

/** Editable dimension chip: shows the value, click → number field. */
function DimChip({
  at,
  title,
  value,
  onSet,
}: {
  at: [number, number, number];
  title: string;
  value: number;
  onSet: (v: number) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && Math.abs(v - value) > 1e-6) onSet(v);
    setEdit(false);
  };
  return (
    <HtmlAt at={at} interactive>
      {edit ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEdit(false);
          }}
          style={{ ...chipStyle(true), width: 64, outline: 'none', textAlign: 'right' }}
          aria-label={title}
        />
      ) : (
        <div
          title={title}
          style={{ ...chipStyle(false), cursor: 'text' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setText(value.toFixed(2).replace('.', ','));
            setEdit(true);
          }}
        >
          {value.toFixed(2).replace('.', ',')} m
        </div>
      )}
    </HtmlAt>
  );
}

/** Invisible hit surface of a façade; highlighted on hover / drag. */
function FaceHandle({
  face,
  z1,
  plan,
  active,
  onDown,
  onHover,
}: {
  face: Face;
  z1: number;
  plan: boolean;
  active: boolean;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onHover: (h: boolean) => void;
}) {
  const [a, b] = face.seg;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const off = 0.06;
  const mid: [number, number] = [
    (a[0] + b[0]) / 2 + face.normal[0] * off,
    (a[1] + b[1]) / 2 + face.normal[1] * off,
  ];
  const strip = useRef<Mesh>(null);
  const { camera, size } = useThree();
  useFrame(() => {
    // plan: horizontal strip of constant screen width along the façade line
    const s = strip.current;
    if (s) s.scale.y = worldPerPixel(camera, s.getWorldPosition(new Vector3()), size.height) * 14;
  });
  const handlers = {
    onPointerDown: onDown,
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(true);
    },
    onPointerOut: () => onHover(false),
    onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
  };
  if (plan)
    return (
      <group position={[mid[0], mid[1], z1 + 20]} rotation={[0, 0, ang]}>
        <mesh ref={strip} renderOrder={19} {...handlers}>
          <planeGeometry args={[len, 1]} />
          <meshBasicMaterial
            color={HOVER}
            transparent
            opacity={active ? 0.45 : 0}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  return (
    <group position={[mid[0], mid[1], z1 / 2]} rotation={[0, 0, ang]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={19} {...handlers}>
        <planeGeometry args={[len, Math.max(0.1, z1)]} />
        <meshBasicMaterial
          color={HOVER}
          transparent
          opacity={active ? 0.3 : 0}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {active && (
        <Line
          points={[
            [-len / 2, 0, -z1 / 2],
            [len / 2, 0, -z1 / 2],
            [len / 2, 0, z1 / 2],
            [-len / 2, 0, z1 / 2],
            [-len / 2, 0, -z1 / 2],
          ]}
          color={HOVER}
          lineWidth={3}
          depthTest={false}
          renderOrder={20}
        />
      )}
    </group>
  );
}

export function DirectEdit({ mass }: { mass: Mass }) {
  const { t } = useTranslation('tools');
  const { camera, gl } = useThree();
  const plan = useUiStore((s) => s.activeView === 'plan');
  const rc = useMemo(() => new Raycaster(), []);
  const { project, masses } = useProjectMasses();
  const [preview, setPreview] = useState<Mass | null>(null);
  const [guides, setGuides] = useState<Segment[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [dragFace, setDragFace] = useState<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const m = preview ?? mass;
  const top = stackTop(m.storeys);
  const fps = massFootprints(m);
  const centre = selectionCentroid([m]);
  const faces = massFaces(m);
  const notation = project?.settings.notation ?? 'fr';
  const ve = useValueEdit.getState;

  const dom = gl.domElement;

  /** Common pointer capture of a drag; `move` gets the pointer event, `commit` ends it. */
  const capture = (
    move: (ev: PointerEvent) => Mass | null,
    edit: { label: string; unit: string; decimals: number; apply: (v: number) => void },
    valueOf: (next: Mass) => number,
    at: () => [number, number, number],
  ) => {
    cleanup.current?.();
    useViewportStore.getState().setControlsEnabled(false);
    let current: Mass | null = null;
    const startValue = valueOf(mass);
    const end = (commit: boolean) => {
      cleanup.current?.();
      cleanup.current = null;
      const typed = typedValue();
      const c = current;
      setPreview(null);
      setGuides([]);
      setDragFace(null);
      if (!commit) return;
      if (typed !== null) {
        edit.apply(typed);
        ve().patch({ value: typed, abortDrag: undefined });
        ve().setTyped('');
        markCommitted();
      } else if (c) {
        actions.updateMass(mass.id, (d) => {
          d.position = c.position;
          d.rotation = c.rotation;
          d.typology = c.typology;
          d.storeys.upper.count = c.storeys.upper.count;
        });
        ve().patch({ abortDrag: undefined });
        markCommitted();
      } else ve().patch({ abortDrag: undefined });
    };
    ve().set({
      ...edit,
      value: startValue,
      at: at(),
      abortDrag: () => end(false),
    });
    const onMove = (ev: PointerEvent) => {
      const next = move(ev);
      if (!next) return;
      current = next;
      setPreview(next);
      ve().patch({ value: valueOf(next) });
    };
    const onUp = () => end(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !useValueEdit.getState().typed) {
        end(false);
        ve().set(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      useViewportStore.getState().setControlsEnabled(true);
      useUiStore.getState().setCursor(null);
    };
  };

  const commitMass = (next: Pick<Mass, 'position' | 'rotation' | 'typology'>, count?: number) =>
    actions.updateMass(mass.id, (d) => {
      d.position = next.position;
      d.rotation = next.rotation;
      d.typology = next.typology;
      if (count !== undefined) d.storeys.upper.count = count;
    });

  // ---- façade push / pull
  const beginFace = (e: ThreeEvent<PointerEvent>, face: Face, fi: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const start = mass;
    const sx = e.nativeEvent.clientX;
    const sy = e.nativeEvent.clientY;
    const grab = e.point.clone();
    const axis = new Vector3(face.normal[0], face.normal[1], 0);
    const geom = project ? collectSnapGeometry(project, masses, [mass.id]) : null;
    const size0 = face.kind === 'side' ? sideSize(start.typology, face.grip.axis) : null;
    const labelKey =
      face.kind === 'side'
        ? face.grip.axis === 'length'
          ? 'edit.length'
          : 'edit.depth'
        : 'edit.offset';
    setDragFace(fi);
    const exact = (v: number) => {
      const delta = size0 !== null ? v - size0 : v;
      commitMass({ ...start, ...applyFace(start, face, delta) });
    };
    let delta = 0;
    capture(
      (ev) => {
        const raw = axisDelta(camera, dom, grab, axis, ev.clientX - sx, ev.clientY - sy);
        if (raw === null) return null;
        const s = useUiStore.getState().snap;
        delta =
          s.enabled && s.grid && s.gridSize > 0 ? Math.round(raw / s.gridSize) * s.gridSize : raw;
        let guide: Segment | null = null;
        if (s.enabled && s.magnet && !ev.altKey && geom) {
          const tol = worldPerPixel(camera, grab, dom.clientHeight) * SNAP_PX * 1.2;
          const moved: Segment = [
            [face.seg[0][0] + face.normal[0] * raw, face.seg[0][1] + face.normal[1] * raw],
            [face.seg[1][0] + face.normal[0] * raw, face.seg[1][1] + face.normal[1] * raw],
          ];
          const f = facadeMagnet(moved, face.normal, geom.edges, tol);
          if (f) {
            delta = raw + f.offset;
            guide = f.guide;
          }
        }
        setGuides(guide ? [guide] : []);
        return { ...start, ...applyFace(start, face, delta) };
      },
      { label: t(labelKey), unit: 'm', decimals: 2, apply: exact },
      (n) =>
        size0 !== null && face.kind === 'side'
          ? (sideSize(n.typology, face.grip.axis) ?? 0)
          : delta,
      () => [grab.x, grab.y, grab.z],
    );
  };

  // ---- vertices (free lines / polygons)
  const beginVertex = (e: ThreeEvent<PointerEvent>, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const start = mass;
    const geom = project ? collectSnapGeometry(project, masses, [mass.id]) : null;
    ve().set(null);
    cleanup.current?.();
    useViewportStore.getState().setControlsEnabled(false);
    let current: Mass | null = null;
    const end = (commit: boolean) => {
      cleanup.current?.();
      cleanup.current = null;
      const c = current;
      setPreview(null);
      if (commit && c) commitMass(c);
    };
    const onMove = (ev: PointerEvent) => {
      const p = groundFromClient(ev.clientX, ev.clientY, dom, camera, rc);
      if (!p) return;
      const tol = worldPerPixel(camera, new Vector3(p[0], p[1], 0), dom.clientHeight) * SNAP_PX;
      const sp = geom ? snapPoint(p, geom, useUiStore.getState().snap, tol).point : p;
      current = { ...start, typology: moveVertex(start, index, sp) };
      setPreview(current);
      useUiStore.getState().setCursor(p);
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
      useUiStore.getState().setCursor(null);
    };
  };

  // ---- storeys (pill on the roof)
  const setStoreys = (count: number) => {
    const c = Math.max(0, Math.round(count));
    actions.updateMass(mass.id, (d) => {
      d.storeys.upper.count = c;
    });
  };
  const beginStoreys = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const start = mass;
    const sx = e.clientX;
    const sy = e.clientY;
    const origin = new Vector3(centre[0], centre[1], top);
    const h = Math.max(0.1, start.storeys.upper.height);
    capture(
      (ev) => {
        const dz = axisDelta(
          camera,
          dom,
          origin,
          new Vector3(0, 0, 1),
          ev.clientX - sx,
          ev.clientY - sy,
        );
        const ds = dz !== null && !plan ? dz / h : -(ev.clientY - sy) / STOREY_PX;
        const count = Math.max(0, Math.round(start.storeys.upper.count + ds));
        return {
          ...start,
          storeys: { ...start.storeys, upper: { ...start.storeys.upper, count } },
        };
      },
      { label: t('edit.storeys'), unit: '', decimals: 0, apply: setStoreys },
      (n) => n.storeys.upper.count,
      () => [centre[0], centre[1], top],
    );
  };

  // ---- rotation (handle at a roof corner)
  const corner = useMemo<Vec2 | null>(() => {
    const f = massFootprints(mass)[0];
    if (!f || !f.outer.length) return null;
    // the corner farthest from the centroid, pushed a little outward
    const c = selectionCentroid([mass]);
    let best = f.outer[0]!;
    let bd = -1;
    for (const p of f.outer) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d > bd + 1e-6) {
        bd = d;
        best = p;
      }
    }
    const k = (bd + 2.5) / Math.max(1e-6, bd);
    return [c[0] + (best[0] - c[0]) * k, c[1] + (best[1] - c[1]) * k];
  }, [mass]);
  const beginRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const start = mass;
    const c = selectionCentroid([start]);
    const plane = new Plane(new Vector3(0, 0, 1), -top);
    const onPlane = (x: number, y: number): Vec2 | null => {
      const v = new Vector3();
      return rayFromClient(x, y, dom, camera, rc).intersectPlane(plane, v) ? [v.x, v.y] : null;
    };
    const p0 = onPlane(e.clientX, e.clientY);
    if (!p0) return;
    const a0 = angleOf(c, p0);
    let ang = 0;
    const exact = (deg: number) =>
      commitMass({ ...start, ...rotateAbout(start, c, (deg * Math.PI) / 180) });
    capture(
      (ev) => {
        const p = onPlane(ev.clientX, ev.clientY);
        if (!p) return null;
        let a = angleOf(c, p) - a0;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        const s = useUiStore.getState().snap;
        if (s.enabled && s.angle && !ev.altKey) {
          const step = (Math.max(1, s.angleStep / 3) * Math.PI) / 180;
          a = Math.round(a / step) * step;
        }
        ang = a;
        return { ...start, ...rotateAbout(start, c, a) };
      },
      { label: t('edit.rotation'), unit: '°', decimals: 1, apply: exact },
      () => (ang * 180) / Math.PI,
      () => [c[0], c[1], top + 1],
    );
  };

  // ---- dimension chips (rectangular typologies)
  const chips: { at: [number, number, number]; axis: SideGrip['axis']; value: number }[] = [];
  for (const f of faces)
    if (f.kind === 'side' && f.grip.sign === -1) {
      const v = sideSize(m.typology, f.grip.axis === 'length' ? 'depth' : 'length');
      // the chip of an axis sits on a side parallel to it
      const axis: SideGrip['axis'] = f.grip.axis === 'length' ? 'depth' : 'length';
      if (v === null) continue;
      const mid: [number, number, number] = [
        (f.seg[0][0] + f.seg[1][0]) / 2 + f.normal[0] * 1.2,
        (f.seg[0][1] + f.seg[1][1]) / 2 + f.normal[1] * 1.2,
        top,
      ];
      chips.push({ at: mid, axis, value: v });
    }
  const setSize = (axis: SideGrip['axis'], v: number) => {
    const s0 = sideSize(mass.typology, axis);
    if (s0 === null) return;
    commitMass({ ...mass, ...applySideGrip(mass, { axis, sign: 1 }, v - s0) });
  };

  const showStoreyCount = preview && preview.storeys.upper.count !== mass.storeys.upper.count;
  const handleCss: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    background: HOVER,
    color: '#fff',
    borderRadius: 14,
    padding: '2px 4px',
    font: '700 12px Inter, system-ui, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,.25)',
    userSelect: 'none',
    cursor: 'ns-resize',
    touchAction: 'none',
  };
  const btn: CSSProperties = {
    border: 0,
    background: 'rgba(255,255,255,.18)',
    color: '#fff',
    borderRadius: 10,
    width: 20,
    height: 20,
    lineHeight: '18px',
    padding: 0,
    cursor: 'pointer',
    font: 'inherit',
  };

  return (
    <group>
      {preview && fps.map((f, i) => <Outline key={i} poly={f} color={GHOST} z={0.1} />)}
      <Guides guides={guides} />
      {!preview &&
        faces.map((f, i) => (
          <FaceHandle
            key={`f${i}`}
            face={f}
            z1={top}
            plan={plan}
            active={hover === i}
            onDown={(e) => beginFace(e, f, i)}
            onHover={(h) => {
              setHover((x) => (h ? i : x === i ? null : x));
              dom.style.cursor = h ? 'move' : '';
            }}
          />
        ))}
      {preview && dragFace !== null && faces[dragFace] && (
        <FaceHandle
          face={faces[dragFace]}
          z1={top}
          plan={plan}
          active
          onDown={() => {}}
          onHover={() => {}}
        />
      )}
      {/* discreet arrows in the middle of each façade (discoverability) */}
      {!preview &&
        faces.map((f, i) => {
          const mid: Vec2 = [(f.seg[0][0] + f.seg[1][0]) / 2, (f.seg[0][1] + f.seg[1][1]) / 2];
          const ang = Math.atan2(f.normal[1], f.normal[0]);
          return (
            <ScreenScaled
              key={`a${i}`}
              position={[mid[0], mid[1], plan ? top + 20 : top / 2]}
              px={11}
            >
              <group rotation={[0, 0, ang - Math.PI / 2]}>
                <mesh
                  position={[0, 1.1, 0]}
                  renderOrder={21}
                  onPointerDown={(e) => beginFace(e, f, i)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <coneGeometry args={[0.55, 1.1, 3]} />
                  <meshBasicMaterial color={hover === i ? HOVER : ACCENT} depthTest={!plan} />
                </mesh>
              </group>
            </ScreenScaled>
          );
        })}
      {vertexGrips(m.typology).map((lp, i) => {
        const w = toWorldPoint(m, lp);
        return (
          <ScreenScaled key={`v${i}`} position={[w[0], w[1], plan ? top + 20 : 0.2]} px={10}>
            <mesh
              renderOrder={20}
              onPointerDown={(e) => beginVertex(e, i)}
              onClick={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={ACCENT} depthTest={false} />
            </mesh>
          </ScreenScaled>
        );
      })}
      {!preview &&
        chips.map((c) => (
          <DimChip
            key={c.axis}
            at={c.at}
            title={t(c.axis === 'length' ? 'edit.length' : 'edit.depth')}
            value={c.value}
            onSet={(v) => setSize(c.axis, v)}
          />
        ))}
      {/* storeys */}
      <HtmlAt at={[centre[0], centre[1], top]} interactive>
        <div style={handleCss} onPointerDown={beginStoreys} title={t('edit.storeysHint')}>
          <button
            style={btn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setStoreys(mass.storeys.upper.count - 1);
            }}
            aria-label="−"
          >
            ▼
          </button>
          <span style={{ padding: '0 5px' }}>
            {storeyLabel(m.storeys.upper.count, notation, false)}
            {showStoreyCount ? ` · ${top.toFixed(2).replace('.', ',')} m` : ''}
          </span>
          <button
            style={btn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setStoreys(mass.storeys.upper.count + 1);
            }}
            aria-label="+"
          >
            ▲
          </button>
        </div>
      </HtmlAt>
      {/* rotation */}
      {corner && !preview && (
        <HtmlAt at={[corner[0], corner[1], top]} interactive>
          <div
            title={t('edit.rotateHint')}
            onPointerDown={beginRotate}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: '#fff',
              border: `2px solid ${HOVER}`,
              color: HOVER,
              display: 'grid',
              placeItems: 'center',
              font: '700 15px system-ui',
              cursor: 'grab',
              boxShadow: '0 2px 8px rgba(0,0,0,.2)',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            ↻
          </div>
        </HtmlAt>
      )}
    </group>
  );
}

/** Measurements box next to the current / last direct edit. */
export function ValueEditLabel() {
  const { t } = useTranslation('tools');
  const edit = useValueEdit((s) => s.edit);
  const typed = useValueEdit((s) => s.typed);
  const ref = useRef<Group>(null);
  if (!edit) return null;
  const val = typed ? `${typed}▏` : edit.value.toFixed(edit.decimals).replace('.', ',');
  return (
    <group ref={ref}>
      <HtmlAt at={edit.at} z={[40, 30]}>
        <div
          style={{
            transform: 'translate(0, -38px)',
            background: '#fff',
            border: `2px solid ${typed ? GHOST : HOVER}`,
            borderRadius: 8,
            padding: '4px 9px',
            font: '700 13px Inter, system-ui, sans-serif',
            color: '#111',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0,0,0,.2)',
          }}
        >
          {edit.label}{' '}
          <span
            style={{
              background: typed ? '#fff3e0' : '#eef2ff',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            {val}
          </span>{' '}
          {edit.unit}
          <div style={{ font: '500 10.5px Inter, system-ui', color: '#64748b', marginTop: 1 }}>
            {t(edit.abortDrag ? 'edit.typeWhileDragging' : 'edit.typeToCorrect')}
          </div>
        </div>
      </HtmlAt>
    </group>
  );
}
