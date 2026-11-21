import type { ContextBuilding, Project, SolidResult } from '@kubatur/core';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, LineDashedMaterial, LineSegments, Material } from 'three';
import { activeVariant } from '../../store/projectStore';
import type { VisualStyle } from '../../store/tools';
import { useUiStore } from '../../store/uiStore';
import { COLORS, usageColor } from './colors';
import { FatSegments } from './FatSegments';
import {
  contextRange,
  buildContextGeometry,
  contextIdAt,
  dashDotSegments,
  extrudePolygon,
  footprintKey,
  prismEdges,
  ringSegments,
  segmentsGeometry,
} from './geometry';

interface Props {
  project: Project;
  solids: readonly SolidResult[];
  style: VisualStyle;
  shadows: boolean;
}

/** Click is a "real" click (not the end of a camera drag) and the select tool is active. */
function selectable(e: ThreeEvent<MouseEvent>): boolean {
  return e.delta <= 4 && useUiStore.getState().tool.kind === 'select';
}

function selectId(id: string, e: ThreeEvent<MouseEvent>) {
  const ui = useUiStore.getState();
  if (e.nativeEvent.ctrlKey || e.nativeEvent.shiftKey || e.nativeEvent.metaKey) {
    ui.setSelection(
      ui.selection.includes(id) ? ui.selection.filter((x) => x !== id) : [...ui.selection, id],
    );
  } else ui.setSelection([id]);
}

function hoverIn(id: string) {
  if (useUiStore.getState().hover !== id) useUiStore.getState().setHover(id);
}
function hoverOut(id: string) {
  if (useUiStore.getState().hover === id) useUiStore.getState().setHover(null);
}

/** Face material props per visual style (lit / unlit, colour). */
function FaceMaterial({ style, color }: { style: VisualStyle; color: string }) {
  const common = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;
  if (style === 'wireframe')
    return <meshBasicMaterial {...common} colorWrite={false} depthWrite={false} />;
  if (style === 'hiddenLine') return <meshBasicMaterial {...common} color={color} />;
  if (style === 'realistic')
    return <meshStandardMaterial {...common} color={color} roughness={0.9} />;
  return <meshLambertMaterial {...common} color={color} />;
}

// ---------------------------------------------------------------------------

function Ground({ style, shadows }: { style: VisualStyle; shadows: boolean }) {
  return (
    <mesh
      position={[0, 0, -0.05]}
      receiveShadow={shadows}
      onClick={(e) => {
        if (!selectable(e)) return;
        e.stopPropagation();
        useUiStore.getState().setSelection([]);
      }}
    >
      <planeGeometry args={[6000, 6000]} />
      {style === 'realistic' ? (
        <meshStandardMaterial color="#e4e2dc" roughness={1} />
      ) : (
        <meshBasicMaterial color={COLORS.ground} />
      )}
    </mesh>
  );
}

function SiteBoundary({ project }: { project: Project }) {
  const b = project.site.boundary;
  const fill = useMemo(() => extrudePolygon(b, 0, 0.02), [b]);
  const segs = useMemo(() => {
    const out: number[] = [];
    for (const r of [b.outer, ...(b.holes ?? [])]) out.push(...dashDotSegments(r, 0.04));
    return out;
  }, [b]);
  const buildable = project.constraints.buildable ?? project.site.buildable;
  const buildableLines = useMemo(() => {
    if (!buildable) return null;
    const out: number[] = [];
    for (const p of buildable)
      for (const r of [p.outer, ...(p.holes ?? [])]) ringSegments(r, 0.05, out);
    const l = new LineSegments(
      segmentsGeometry(out),
      new LineDashedMaterial({ color: COLORS.siteLine, dashSize: 1, gapSize: 0.7 }),
    );
    l.computeLineDistances();
    return l;
  }, [buildable]);
  if (b.outer.length < 3) return null;
  return (
    <group>
      {fill && (
        <mesh geometry={fill} raycast={() => null}>
          <meshBasicMaterial
            color={COLORS.siteFill}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      )}
      <FatSegments segments={segs} color={COLORS.siteLine} width={2.5} />
      {buildableLines && <primitive object={buildableLines} />}
    </group>
  );
}

function ContextBuildings({
  buildings,
  style,
  shadows,
}: {
  buildings: readonly ContextBuilding[];
  style: VisualStyle;
  shadows: boolean;
}) {
  const geo = useMemo(() => buildContextGeometry(buildings), [buildings]);
  const lines = useMemo(() => {
    const solid = new LineSegments(segmentsGeometry(geo.edges));
    const est = new LineSegments(
      segmentsGeometry(geo.edgesEstimated),
      new LineDashedMaterial({ color: COLORS.contextEdge, dashSize: 0.8, gapSize: 0.6 }),
    );
    est.computeLineDistances();
    const demo = new LineSegments(
      segmentsGeometry(geo.edgesDemolished),
      new LineDashedMaterial({
        color: COLORS.demolished,
        dashSize: 0.5,
        gapSize: 0.5,
        transparent: true,
        opacity: 0.6,
      }),
    );
    demo.computeLineDistances();
    for (const l of [solid, est, demo]) l.raycast = () => undefined;
    return { solid, est, demo };
  }, [geo]);
  useEffect(
    () => () => {
      geo.faces?.dispose();
      for (const l of Object.values(lines)) {
        l.geometry.dispose();
        (l.material as Material).dispose();
      }
    },
    [geo, lines],
  );
  const edgeColor = style === 'realistic' ? '#a8a8a8' : COLORS.contextEdge;
  useEffect(() => {
    (lines.solid.material as LineDashedMaterial).color?.set(edgeColor);
  }, [lines, edgeColor]);
  const idOf = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.faceIndex == null ? null : contextIdAt(geo, e.faceIndex);
  return (
    <group>
      {geo.faces && (
        <mesh
          geometry={geo.faces}
          castShadow={shadows}
          receiveShadow={shadows}
          onClick={(e) => {
            if (!selectable(e)) return;
            e.stopPropagation();
            const id = idOf(e);
            if (id) selectId(id, e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            const id = idOf(e);
            if (id) hoverIn(id);
          }}
          onPointerOut={() => {
            const h = useUiStore.getState().hover;
            if (h && geo.ids.includes(h)) useUiStore.getState().setHover(null);
          }}
        >
          <FaceMaterial style={style} color={style === 'hiddenLine' ? '#fbfbfb' : COLORS.context} />
        </mesh>
      )}
      <primitive object={lines.solid} />
      <primitive object={lines.est} />
      <primitive object={lines.demo} />
    </group>
  );
}

// ---------------------------------------------------------------------------

interface MassSolidGeo {
  massId: string;
  usage: SolidResult['solid']['usage'];
  geometry: BufferGeometry;
}

interface MassEdges {
  thick: number[];
  thin: number[];
}

function buildMasses(project: Project, solids: readonly SolidResult[]) {
  const parapetOf = new Map(activeVariant(project).masses.map((m) => [m.id, m.storeys.parapet]));
  const out: MassSolidGeo[] = [];
  const edges = new Map<string, MassEdges>();
  // keys of footprints by mass at their bottom / top heights (to find interior slab lines)
  const tops = new Set<string>();
  const bottoms = new Set<string>();
  const k = (m: string, z: number, f: string) => `${m}@${z.toFixed(3)}#${f}`;
  const zTop = (s: SolidResult['solid']) => s.z1 + (s.top ? (parapetOf.get(s.massId) ?? 0) : 0);
  for (const { solid: s } of solids) {
    const f = footprintKey(s.footprint);
    tops.add(k(s.massId, zTop(s), f));
    bottoms.add(k(s.massId, s.z0, f));
  }
  for (const { solid: s } of solids) {
    const z1 = zTop(s);
    const g = extrudePolygon(s.footprint, s.z0, z1);
    if (!g) continue;
    out.push({ massId: s.massId, usage: s.usage, geometry: g });
    const e = edges.get(s.massId) ?? { thick: [], thin: [] };
    edges.set(s.massId, e);
    const f = footprintKey(s.footprint);
    const coveredBelow = tops.has(k(s.massId, s.z0, f));
    const coveredAbove = bottoms.has(k(s.massId, z1, f));
    prismEdges(s.footprint, s.z0, z1, { bottom: !coveredBelow, top: !coveredAbove }, e.thick);
    if (coveredBelow) prismEdges(s.footprint, s.z0, z1, { top: false, vertical: false }, e.thin);
    if (s.top && z1 > s.z1)
      prismEdges(s.footprint, s.z1, s.z1, { top: false, vertical: false }, e.thin);
  }
  return { solids: out, edges };
}

function Masses({ project, solids, style, shadows }: Props) {
  const built = useMemo(() => buildMasses(project, solids), [project, solids]);
  useEffect(() => () => built.solids.forEach((s) => s.geometry.dispose()), [built]);
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const faceColor = (u: MassSolidGeo['usage']) =>
    style === 'consistentColors'
      ? usageColor(u)
      : style === 'hiddenLine'
        ? COLORS.massHidden
        : COLORS.massWarm;
  return (
    <group>
      {built.solids.map((s, i) => (
        <group key={i}>
          <mesh
            geometry={s.geometry}
            castShadow={shadows}
            receiveShadow={shadows}
            onClick={(e) => {
              if (!selectable(e)) return;
              e.stopPropagation();
              selectId(s.massId, e);
            }}
            onPointerMove={(e) => {
              e.stopPropagation();
              hoverIn(s.massId);
            }}
            onPointerOut={() => hoverOut(s.massId)}
          >
            <FaceMaterial style={style} color={faceColor(s.usage)} />
          </mesh>
          {selection.includes(s.massId) && (
            <mesh geometry={s.geometry} raycast={() => null} renderOrder={2}>
              <meshBasicMaterial
                color={COLORS.selection}
                transparent
                opacity={0.35}
                depthWrite={false}
                side={DoubleSide}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          )}
        </group>
      ))}
      {[...built.edges].map(([id, e]) => {
        const hot = hover === id || selection.includes(id);
        return (
          <group key={id}>
            <FatSegments
              segments={e.thick}
              color={hot ? COLORS.selection : COLORS.massEdge}
              width={hot ? 3 : style === 'realistic' ? 1.2 : 2}
            />
            <ThinLines segments={e.thin} color={hot ? COLORS.selection : COLORS.storeyLine} />
          </group>
        );
      })}
    </group>
  );
}

function ThinLines({ segments, color }: { segments: readonly number[]; color: string }) {
  const g = useMemo(() => segmentsGeometry(segments), [segments]);
  useEffect(() => () => g.dispose(), [g]);
  return (
    <lineSegments geometry={g} raycast={() => null}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

function SelectedContext({ buildings }: { buildings: readonly ContextBuilding[] }) {
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const segs = useMemo(() => {
    const out: number[] = [];
    for (const b of buildings) {
      if (b.hidden || (b.id !== hover && !selection.includes(b.id))) continue;
      const [z0, z1] = contextRange(b);
      prismEdges(b.footprint, z0, z1, {}, out);
    }
    return out;
  }, [buildings, selection, hover]);
  return <FatSegments segments={segs} color={COLORS.selection} width={2.5} />;
}

export function SceneContent(props: Props) {
  const { project, style, shadows } = props;
  return (
    <group>
      <Ground style={style} shadows={shadows} />
      <SiteBoundary project={project} />
      <ContextBuildings buildings={project.context} style={style} shadows={shadows} />
      <SelectedContext buildings={project.context} />
      <Masses {...props} />
    </group>
  );
}
