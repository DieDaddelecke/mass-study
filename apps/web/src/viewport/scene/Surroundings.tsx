import {
  intersection,
  rect,
  ringCentroid,
  type Polygon,
  type Project,
  type Surroundings as SurroundingsData,
} from '@kubatur/core';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferGeometry,
  CylinderGeometry,
  ConeGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineDashedMaterial,
  LineSegments,
  MeshLambertMaterial,
  type Material,
} from 'three';
import type { ScenePalette } from '../../theme/palette';
import type { VisualStyle } from '../../store/tools';
import type { ContextLayers } from '../viewportStore';
import { segmentsGeometry } from './geometry';
import {
  buildRoadRibbons,
  flatPolygonsGeometry,
  hedgeGeometry,
  polygonOutlineSegments,
} from './surroundingsGeometry';
import { buildTreeInstances, scatterTreesInGreen, type TreeInstanceSet } from './treeInstances';

/** Heights of the flat context layers (ground plane at -0.05, site fill 0…0.02). */
export const Z = {
  basemap: -0.045,
  green: -0.04,
  water: -0.038,
  road: -0.03,
  roadEdge: -0.028,
  parcel: -0.02,
};

const noRaycast = () => null;

interface Props {
  project: Project;
  data: SurroundingsData;
  layers: ContextLayers;
  pal: ScenePalette;
  style: VisualStyle;
  shadows: boolean;
}

function useDispose(obj: { dispose: () => void } | null | undefined) {
  useEffect(() => () => obj?.dispose(), [obj]);
}

function Flat({
  geometry,
  color,
  opacity,
  order,
}: {
  geometry: BufferGeometry | null;
  color: string;
  opacity: number;
  order: number;
}) {
  useDispose(geometry);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={order} receiveShadow>
      <meshLambertMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-order}
      />
    </mesh>
  );
}

function Lines({
  segments,
  color,
  opacity = 1,
  dashed,
  order,
}: {
  segments: number[];
  color: string;
  opacity?: number;
  dashed?: [number, number];
  order: number;
}) {
  const obj = useMemo(() => {
    const g = segmentsGeometry(segments);
    const m = new LineDashedMaterial({
      dashSize: dashed?.[0] ?? 1,
      gapSize: dashed ? dashed[1] : 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    });
    const l = new LineSegments(g, m);
    if (dashed) l.computeLineDistances();
    else m.gapSize = 0;
    l.renderOrder = order;
    l.raycast = () => undefined;
    return l;
  }, [segments, opacity, dashed, order]);
  useEffect(() => {
    (obj.material as LineDashedMaterial).color.set(color);
  }, [obj, color]);
  useEffect(
    () => () => {
      obj.geometry.dispose();
      (obj.material as Material).dispose();
    },
    [obj],
  );
  if (!segments.length) return null;
  return <primitive object={obj} />;
}

function Roads({ data, pal, dim }: { data: SurroundingsData; pal: ScenePalette; dim: boolean }) {
  const built = useMemo(() => {
    const ribbons = buildRoadRibbons(data.roads);
    return ribbons.groups.map((g) => {
      const lift = g.level === 1 ? 0.3 : 0;
      const z = (g.cls === 'carriageway' ? Z.road : Z.road - 0.004) + lift;
      return {
        key: `${g.cls}:${g.level}`,
        cls: g.cls,
        geometry: flatPolygonsGeometry(g.polygons, z),
        edges: g.cls === 'carriageway' ? polygonOutlineSegments(g.polygons, Z.roadEdge + lift) : [],
      };
    });
  }, [data.roads]);
  const op = dim ? 0.35 : 1;
  return (
    <group>
      {built.map((b) => (
        <group key={b.key}>
          <Flat
            geometry={b.geometry}
            color={
              b.cls === 'carriageway' ? pal.road : b.cls === 'footway' ? pal.footway : pal.massEdge
            }
            opacity={b.cls === 'rail' ? Math.min(op, 0.7) : op}
            order={b.cls === 'carriageway' ? 3 : 2}
          />
          <Lines segments={b.edges} color={pal.contextEdge} opacity={dim ? 0.5 : 0.55} order={4} />
        </group>
      ))}
    </group>
  );
}

function GreenWater({
  data,
  layers,
  pal,
  dim,
}: {
  data: SurroundingsData;
  layers: ContextLayers;
  pal: ScenePalette;
  dim: boolean;
}) {
  const g = useMemo(() => {
    const wood = data.green
      .filter((x) => x.kind === 'wood' || x.kind === 'scrub')
      .map((x) => x.footprint);
    const hedge = data.green.filter((x) => x.kind === 'hedge').map((x) => x.footprint);
    const rest = data.green
      .filter((x) => x.kind !== 'wood' && x.kind !== 'scrub' && x.kind !== 'hedge')
      .map((x) => x.footprint);
    return {
      wood: flatPolygonsGeometry(wood, Z.green),
      rest: flatPolygonsGeometry(rest, Z.green + 0.001),
      hedge: hedgeGeometry(hedge, 0.8),
      water: flatPolygonsGeometry(
        data.water.map((w) => w.footprint),
        Z.water,
      ),
    };
  }, [data.green, data.water]);
  const op = dim ? 0.35 : 1;
  return (
    <group>
      {layers.green && (
        <>
          <Flat geometry={g.wood} color={pal.wood} opacity={op} order={1} />
          <Flat geometry={g.rest} color={pal.green} opacity={op} order={1} />
          <Hedge geometry={g.hedge} color={pal.tree} />
        </>
      )}
      {layers.water && (
        <Flat geometry={g.water} color={pal.water} opacity={dim ? 0.5 : 1} order={2} />
      )}
    </group>
  );
}

function Hedge({ geometry, color }: { geometry: BufferGeometry | null; color: string }) {
  useDispose(geometry);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} raycast={noRaycast} castShadow receiveShadow>
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------

function Instances({
  set,
  geometry,
  color,
  tinted,
  shadows,
}: {
  set: TreeInstanceSet;
  geometry: BufferGeometry;
  color: string;
  tinted: boolean;
  shadows: boolean;
}) {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({ flatShading: tinted }),
      set.count,
    );
    m.instanceMatrix.array.set(set.matrices.subarray(0, set.count * 16));
    m.instanceMatrix.needsUpdate = true;
    if (tinted)
      m.instanceColor = new InstancedBufferAttribute(set.colors.slice(0, set.count * 3), 3);
    m.raycast = () => undefined;
    m.computeBoundingSphere();
    return m;
  }, [set, geometry, tinted]);
  useLayoutEffect(() => {
    (mesh.material as MeshLambertMaterial).color.set(tinted ? '#ffffff' : color);
  }, [mesh, color, tinted]);
  useEffect(() => {
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
  }, [mesh, shadows]);
  useEffect(() => () => (mesh.material as Material).dispose(), [mesh]);
  if (!set.count) return null;
  return <primitive object={mesh} />;
}

function Trees({
  project,
  data,
  pal,
  shadows,
}: {
  project: Project;
  data: SurroundingsData;
  pal: ScenePalette;
  shadows: boolean;
}) {
  const geos = useMemo(
    () => ({
      crown: new IcosahedronGeometry(1, 1),
      cone: new ConeGeometry(1, 2, 7),
      trunk: new CylinderGeometry(1, 1, 1, 5),
    }),
    [],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  const trees = useMemo(() => {
    const exclude = [project.site.boundary, ...project.context.map((b) => b.footprint)];
    // data.green is already clipped to the context extent (clipAreas).
    return [...data.trees, ...scatterTreesInGreen(data.green, exclude)];
  }, [data.trees, data.green, project.site.boundary, project.context]);
  const inst = useMemo(() => buildTreeInstances(trees, pal.tree), [trees, pal.tree]);
  return (
    <group>
      <Instances set={inst.broad} geometry={geos.crown} color={pal.tree} tinted shadows={shadows} />
      <Instances set={inst.needle} geometry={geos.cone} color={pal.tree} tinted shadows={shadows} />
      <Instances
        set={inst.trunks}
        geometry={geos.trunk}
        color={pal.contextEdge}
        tinted={false}
        shadows={shadows}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------

function Parcels({
  project,
  data,
  pal,
}: {
  project: Project;
  data: SurroundingsData;
  pal: ScenePalette;
}) {
  const siteRefs = useMemo(
    () => new Set(project.site.parcels.map((p) => p.ref).filter(Boolean)),
    [project.site.parcels],
  );
  const shown = useMemo(
    () => data.parcels.filter((p) => !p.ref || !siteRefs.has(p.ref)),
    [data.parcels, siteRefs],
  );
  const segs = useMemo(
    () =>
      polygonOutlineSegments(
        shown.map((p) => p.polygon),
        Z.parcel,
      ),
    [shown],
  );
  return (
    <group>
      <Lines segments={segs} color={pal.parcel} opacity={0.85} dashed={[1.6, 0.8]} order={5} />
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Streets, vegetation, water and neighbouring parcels around the site. */
/** Max half size of the area that green and water are clipped to, m. */
const CLIP_MAX = 400;

/**
 * Large forests / water bodies reach kilometres beyond the loaded context: clip them to the extent
 * of the other context data (roads, buildings, site), at most CLIP_MAX around the site.
 */
function clipAreas(data: SurroundingsData, project: Project): SurroundingsData {
  const ring = project.site.boundary.outer;
  const [cx, cy] = ring.length ? ringCentroid(ring) : [0, 0];
  let minX = cx - 60,
    minY = cy - 60,
    maxX = cx + 60,
    maxY = cy + 60;
  const add = ([x, y]: readonly [number, number]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const r of data.roads) r.centerline.forEach(add);
  for (const b of project.context) b.footprint.outer.forEach(add);
  const box = [
    rect(
      Math.max(minX, cx - CLIP_MAX),
      Math.max(minY, cy - CLIP_MAX),
      Math.min(maxX, cx + CLIP_MAX),
      Math.min(maxY, cy + CLIP_MAX),
    ),
  ];
  const clip = <T extends { id: string; footprint: Polygon }>(items: readonly T[]): T[] =>
    items.flatMap((it) =>
      intersection([it.footprint], box).map((footprint, i) => ({
        ...it,
        id: i ? `${it.id}#c${i}` : it.id,
        footprint,
      })),
    );
  return { ...data, green: clip(data.green), water: clip(data.water) };
}

export function Surroundings({ project, data: raw, layers, pal, style, shadows }: Props) {
  const data = useMemo(() => clipAreas(raw, project), [raw, project]);
  const dim = layers.basemap !== 'none';
  const wire = style === 'wireframe';
  return (
    <group>
      {(layers.green || layers.water) && !wire && (
        <GreenWater data={data} layers={layers} pal={pal} dim={dim} />
      )}
      {layers.roads && <Roads data={data} pal={pal} dim={dim || wire} />}
      {layers.trees && <Trees project={project} data={data} pal={pal} shadows={shadows} />}
      {layers.parcels && <Parcels project={project} data={data} pal={pal} />}
    </group>
  );
}
