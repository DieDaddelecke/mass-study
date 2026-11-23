import {
  difference,
  effectiveParapet,
  intersection,
  polygonArea,
  resolveStairRules,
  type PlantingZone,
  type RoofPiece,
  type ContextBuilding,
  type Mass,
  type MassLayout,
  type Polygon,
  type Project,
  type SolidResult,
} from '@kubatur/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, LineDashedMaterial, LineSegments, Material } from 'three';
import { activeVariant } from '../../store/projectStore';
import type { VisualStyle } from '../../store/tools';
import { useUiStore } from '../../store/uiStore';
import { palette, type ScenePalette } from '../../theme/palette';
import { useLook } from './useLook';
import { LIT_STYLES } from './looks';
import { SkyBackground } from './SkyBackground';
import { Basemap } from './Basemap';
import { COLORS, usageColor } from './colors';
import { useLayers } from './sceneLayers';
import { startMassDrag } from '../tools/ToolLayer';
import { Plantings } from './Plantings';
import { roofGeometry } from './roofGeometry';
import { StoreyCut } from './StoreyCutLayer';
import { massesCutAt } from './storeyCut';

const EMPTY_ZONES: PlantingZone[] = [];
import { Surroundings, Z } from './Surroundings';
import { FatSegments } from './FatSegments';
import {
  buildGranulometry,
  buildOutdoor,
  LOGGIA_SLAB,
  storeyKey,
  type OutdoorScene,
} from './granulometry';
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
  /** Pitched roof faces. */
  roofs?: readonly RoofPiece[];
  style: VisualStyle;
  shadows: boolean;
  /** Dwelling layouts (outdoor spaces; dwellings in the granulometry style). */
  layouts?: readonly MassLayout[] | null;
  /** Storey cut: this storey is cut like a floor plan, everything above is hidden. */
  cutLevel?: number | null;
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
  // explicit colorWrite / depthWrite: r3f reuses the material instance when switching from the
  // wireframe style and would otherwise keep its invisible settings.
  if (style === 'hiddenLine')
    return <meshBasicMaterial {...common} color={color} colorWrite depthWrite />;
  if (style === 'realistic')
    return <meshStandardMaterial {...common} color={color} roughness={0.9} />;
  return <meshLambertMaterial {...common} color={color} />;
}

/**
 * Shadows only depend on the model and the sun, not on the camera: the shadow map is redrawn
 * when the scene is re-rendered by React (model, look, layers, storey cut, …), not on every
 * frame while orbiting. Rendered last in SceneContent so it runs after every content change.
 */
function ShadowCache() {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useLayoutEffect(() => {
    gl.shadowMap.needsUpdate = true;
  });
  return null;
}

// ---------------------------------------------------------------------------

const ACCENT = palette.accent;

function Ground({
  style,
  shadows,
  pal,
}: {
  style: VisualStyle;
  shadows: boolean;
  pal: ScenePalette;
}) {
  return (
    <mesh
      position={[0, 0, -0.05]}
      renderOrder={-10}
      receiveShadow={shadows}
      onClick={(e) => {
        if (!selectable(e)) return;
        e.stopPropagation();
        useUiStore.getState().setSelection([]);
      }}
    >
      <planeGeometry args={[6000, 6000]} />
      {LIT_STYLES.has(style) ? (
        <meshLambertMaterial color={pal.ground} depthWrite={false} />
      ) : (
        <meshBasicMaterial color={pal.ground} depthWrite={false} />
      )}
    </mesh>
  );
}

function SiteBoundary({
  project,
  pal,
  fillOpacity,
}: {
  project: Project;
  pal: ScenePalette;
  fillOpacity: number;
}) {
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
  useEffect(() => {
    (buildableLines?.material as LineDashedMaterial | undefined)?.color.set(pal.site);
  }, [buildableLines, pal.site]);
  if (b.outer.length < 3) return null;
  return (
    <group>
      {fill && (
        <mesh geometry={fill} raycast={() => null}>
          <meshBasicMaterial
            color={pal.site}
            transparent
            opacity={fillOpacity}
            depthWrite={false}
          />
        </mesh>
      )}
      <FatSegments segments={segs} color={pal.site} width={2.5} />
      {buildableLines && <primitive object={buildableLines} />}
    </group>
  );
}

function ContextBuildings({
  buildings,
  style,
  shadows,
  pal,
}: {
  buildings: readonly ContextBuilding[];
  style: VisualStyle;
  shadows: boolean;
  pal: ScenePalette;
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
  const edgeColor = pal.contextEdge;
  useEffect(() => {
    (lines.solid.material as LineDashedMaterial).color?.set(edgeColor);
    (lines.est.material as LineDashedMaterial).color?.set(edgeColor);
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
          <FaceMaterial style={style} color={pal.contextBuilding} />
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
  /** Whole storey volume (picking, selection highlight). */
  geometry: BufferGeometry;
  /** Rendered faces: the volume, or only its parapet when the granulometry replaces it. */
  face: BufferGeometry | null;
}

interface MassEdges {
  thick: number[];
  thin: number[];
}

/** Prisms of several polygons as one geometry. */
function extrudeAll(polys: readonly Polygon[], z0: number, z1: number): BufferGeometry | null {
  const gs = polys.map((p) => extrudePolygon(p, z0, z1)).filter((g): g is BufferGeometry => !!g);
  if (gs.length <= 1) return gs[0] ?? null;
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  return out;
}

function mergeAll(gs: (BufferGeometry | null)[]): BufferGeometry | null {
  const list = gs
    .filter((g): g is BufferGeometry => !!g)
    .map((g) => (g.index ? g.toNonIndexed() : g));
  if (list.length <= 1) return list[0] ?? null;
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

function buildMasses(
  masses: readonly Mass[],
  solids: readonly SolidResult[],
  covered: ReadonlySet<string> = new Set(),
  cuts: ReadonlyMap<string, Polygon[]> = new Map(),
) {
  const parapetOf = new Map(masses.map((m) => [m.id, effectiveParapet(m, m.storeys)]));
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
    const f = footprintKey(s.footprint);
    const cutPolys = cuts.get(storeyKey(s));
    // loggias: cut out up to the slab of the storey above (or the roof)
    const zc = s.z1 - LOGGIA_SLAB;
    const loggias =
      cutPolys && zc > s.z0
        ? intersection([s.footprint], cutPolys).filter((p) => polygonArea(p) > 0.05)
        : [];
    const g = loggias.length
      ? mergeAll([
          extrudeAll(difference([s.footprint], cutPolys!), s.z0, zc),
          extrudePolygon(s.footprint, zc, z1),
        ])
      : extrudePolygon(s.footprint, s.z0, z1);
    if (!g) continue;
    const face = covered.has(storeyKey(s))
      ? z1 > s.z1
        ? extrudePolygon(s.footprint, s.z1, z1)
        : null
      : g;
    out.push({ massId: s.massId, usage: s.usage, geometry: g, face });
    const e = edges.get(s.massId) ?? { thick: [], thin: [] };
    edges.set(s.massId, e);
    const coveredBelow = tops.has(k(s.massId, s.z0, f));
    const coveredAbove = bottoms.has(k(s.massId, z1, f));
    prismEdges(s.footprint, s.z0, z1, { bottom: !coveredBelow, top: !coveredAbove }, e.thick);
    for (const p of loggias) prismEdges(p, s.z0, zc, {}, e.thick);
    if (coveredBelow) prismEdges(s.footprint, s.z0, z1, { top: false, vertical: false }, e.thin);
    if (s.top && z1 > s.z1)
      prismEdges(s.footprint, s.z1, s.z1, { top: false, vertical: false }, e.thin);
  }
  return { solids: out, edges };
}

function Masses(props: Props & { pal: ScenePalette; edgeWidth: number }) {
  const { project, style, shadows, pal, edgeWidth } = props;
  const cut = props.cutLevel ?? null;
  // with a storey cut: only the storeys below it are drawn as volumes
  const solids = useMemo(
    () => (cut === null ? props.solids : props.solids.filter((r) => r.solid.storeyIndex < cut)),
    [props.solids, cut],
  );
  const layouts = useMemo(
    () =>
      cut === null || !props.layouts
        ? props.layouts
        : props.layouts.map((m) => ({
            ...m,
            storeys: m.storeys.filter((st) => st.storeyIndex <= cut),
          })),
    [props.layouts, cut],
  );
  const roofs = useMemo(() => {
    if (cut === null) return props.roofs;
    const gone = massesCutAt(
      props.solids.map((r) => r.solid),
      cut,
    );
    return props.roofs?.filter((r) => !gone.has(r.massId));
  }, [props.roofs, props.solids, cut]);
  const granulo = useMemo(
    () =>
      style === 'granulometry' && layouts
        ? buildGranulometry(
            layouts,
            solids.map((r) => r.solid),
            project.settings.unitMix,
          )
        : null,
    [style, layouts, solids, project.settings.unitMix],
  );
  useEffect(() => () => granulo?.masses.forEach((m) => m.geometry.dispose()), [granulo]);
  const outdoor = useMemo(() => (layouts ? buildOutdoor(layouts) : null), [layouts]);
  const stairRules = useMemo(() => resolveStairRules(project.settings), [project.settings]);
  useEffect(
    () => () => {
      outdoor?.slabs?.dispose();
      outdoor?.rails?.dispose();
    },
    [outdoor],
  );
  // only the masses matter here: a change of vegetation, constraints, … keeps the geometry
  const masses = activeVariant(project).masses;
  const built = useMemo(
    () => buildMasses(masses, solids, granulo?.covered, outdoor?.loggias),
    [masses, solids, granulo, outdoor],
  );
  useEffect(
    () => () =>
      built.solids.forEach((s) => {
        s.geometry.dispose();
        if (s.face !== s.geometry) s.face?.dispose();
      }),
    [built],
  );
  const pick = (id: string) => ({
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (startMassDrag(e.nativeEvent, id)) e.stopPropagation();
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!selectable(e)) return;
      e.stopPropagation();
      selectId(id, e);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      hoverIn(id);
    },
    onPointerOut: () => hoverOut(id),
  });
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const faceColor = (u: MassSolidGeo['usage']) =>
    style === 'consistentColors' ? usageColor(u) : pal.mass;
  return (
    <group>
      {built.solids.map((s, i) => (
        <group key={i}>
          {s.face && (
            <mesh
              geometry={s.face}
              castShadow={shadows}
              receiveShadow={shadows}
              {...pick(s.massId)}
            >
              <FaceMaterial style={style} color={faceColor(s.usage)} />
            </mesh>
          )}
          {selection.includes(s.massId) && (
            <mesh geometry={s.geometry} raycast={() => null} renderOrder={2}>
              <meshBasicMaterial
                color={ACCENT}
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
      {granulo?.masses.map((g) => (
        <group key={`g-${g.massId}`}>
          <mesh
            geometry={g.geometry}
            castShadow={shadows}
            receiveShadow={shadows}
            {...pick(g.massId)}
          >
            <meshLambertMaterial
              vertexColors
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
          <ThinLines segments={g.edges} color={pal.contextEdge} />
        </group>
      ))}
      {cut !== null && (
        <StoreyCut
          solids={props.solids}
          layouts={props.layouts}
          level={cut}
          mix={project.settings.unitMix}
          wallColor={pal.mass}
          loggias={outdoor?.loggias}
          stairRules={stairRules}
          style={style}
          shadows={shadows}
          pick={pick}
        />
      )}
      <Roofs
        roofs={roofs}
        style={style}
        shadows={shadows}
        pal={pal}
        faceColor={pal.mass}
        edgeWidth={edgeWidth}
      />
      {outdoor && style !== 'wireframe' && (
        <OutdoorMeshes o={outdoor} style={style} shadows={shadows} pal={pal} />
      )}
      {[...built.edges].map(([id, e]) => {
        const hot = hover === id || selection.includes(id);
        return (
          <group key={id}>
            <FatSegments
              segments={e.thick}
              color={hot ? ACCENT : pal.massEdge}
              width={hot ? 3 : style === 'realistic' ? Math.min(1.2, edgeWidth) : edgeWidth}
            />
            <ThinLines segments={e.thin} color={hot ? ACCENT : pal.contextEdge} />
          </group>
        );
      })}
    </group>
  );
}

function Roofs({
  roofs,
  style,
  shadows,
  pal,
  faceColor,
  edgeWidth,
}: {
  roofs?: readonly RoofPiece[] | undefined;
  style: VisualStyle;
  shadows: boolean;
  pal: ScenePalette;
  faceColor: string;
  edgeWidth: number;
}) {
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const built = useMemo(() => {
    const byMass = new Map<string, RoofPiece[]>();
    for (const r of roofs ?? []) {
      const l = byMass.get(r.massId) ?? [];
      l.push(r);
      byMass.set(r.massId, l);
    }
    return [...byMass].map(([id, ps]) => ({ id, ...roofGeometry(ps) }));
  }, [roofs]);
  useEffect(() => () => built.forEach((b) => b.geometry?.dispose()), [built]);
  return (
    <group>
      {built.map((b) => {
        const hot = hover === b.id || selection.includes(b.id);
        return (
          <group key={b.id}>
            {b.geometry && (
              <mesh
                geometry={b.geometry}
                castShadow={shadows}
                receiveShadow={shadows}
                onClick={(e) => {
                  if (!selectable(e)) return;
                  e.stopPropagation();
                  selectId(b.id, e);
                }}
                onPointerDown={(e) => {
                  if (startMassDrag(e.nativeEvent, b.id)) e.stopPropagation();
                }}
                onPointerMove={(e) => {
                  e.stopPropagation();
                  hoverIn(b.id);
                }}
                onPointerOut={() => hoverOut(b.id)}
              >
                {style === 'wireframe' ? (
                  <meshBasicMaterial colorWrite={false} depthWrite={false} side={DoubleSide} />
                ) : (
                  <meshLambertMaterial
                    color={faceColor}
                    side={DoubleSide}
                    polygonOffset
                    polygonOffsetFactor={1}
                    polygonOffsetUnits={1}
                  />
                )}
              </mesh>
            )}
            <FatSegments
              segments={b.edges}
              color={hot ? ACCENT : pal.massEdge}
              width={hot ? 3 : style === 'realistic' ? Math.min(1.2, edgeWidth) : edgeWidth}
            />
          </group>
        );
      })}
    </group>
  );
}

function OutdoorMeshes({
  o,
  style,
  shadows,
  pal,
}: {
  o: OutdoorScene;
  style: VisualStyle;
  shadows: boolean;
  pal: ScenePalette;
}) {
  return (
    <group>
      {o.slabs && (
        <mesh geometry={o.slabs} castShadow={shadows} receiveShadow={shadows} raycast={() => null}>
          <FaceMaterial style={style} color={pal.mass} />
        </mesh>
      )}
      {o.rails && (
        <mesh geometry={o.rails} raycast={() => null} renderOrder={3}>
          <meshBasicMaterial
            color="#9fb4c4"
            transparent
            opacity={0.22}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      )}
      <ThinLines segments={o.edges} color={pal.massEdge} />
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
  return <FatSegments segments={segs} color={ACCENT} width={2.5} />;
}

export function SceneContent(props: Props) {
  const { project, style, shadows } = props;
  const look = useLook();
  const pal = look.pal;
  const layers = useLayers();
  return (
    <group>
      <SkyBackground top={look.sky[0]} horizon={look.sky[1]} />
      <fog attach="fog" args={[look.sky[1], 900, 3200]} />
      <Ground style={style} shadows={shadows} pal={pal} />
      {layers.basemap !== 'none' && style !== 'wireframe' && (
        <Basemap project={project} kind={layers.basemap} z={Z.basemap} />
      )}
      {project.surroundings && (
        <Surroundings
          project={project}
          data={project.surroundings}
          layers={layers}
          pal={pal}
          style={style}
          shadows={shadows}
        />
      )}
      <SiteBoundary project={project} pal={pal} fillOpacity={look.siteFill} />
      {layers.buildings && (
        <>
          <ContextBuildings buildings={project.context} style={style} shadows={shadows} pal={pal} />
          <SelectedContext buildings={project.context} />
        </>
      )}
      <Plantings
        zones={activeVariant(project).plantings ?? EMPTY_ZONES}
        pal={pal}
        shadows={shadows}
      />
      <Masses {...props} pal={pal} edgeWidth={look.edgeWidth} />
      <ShadowCache />
    </group>
  );
}
