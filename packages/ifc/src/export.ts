import type {
  MassResult,
  Polygon,
  Project,
  SolidResult,
  TypologyKind,
  Usage,
  Vec2,
  VariantResult,
} from '@kubatur/core';
import { guidFactory } from './guid.js';
import {
  DERIVED,
  NULL,
  StepWriter,
  bool,
  enumv,
  int,
  list,
  real,
  str,
  typed,
  type StepRef,
  type StepToken,
} from './step.js';

/** Texts written into the file (the web app passes the UI language; defaults are French). */
export interface IfcLabels {
  /** IfcBuilding name prefix, followed by " – {variant}". */
  building: string;
  site: string;
  usage: Record<Usage, string>;
  typology: Record<TypologyKind, string>;
  slab: string;
  context: string;
}

export const IFC_LABELS_FR: IfcLabels = {
  building: 'Étude de capacité',
  site: 'Terrain',
  usage: {
    wohnen: 'Logement',
    buero: 'Bureaux',
    gewerbe: 'Commerce / activité',
    gemeinbedarf: 'Équipement',
    parken: 'Stationnement',
    technik: 'Locaux techniques',
  },
  typology: {
    solitaer: 'Plot',
    zeile: 'Barre',
    reihe: 'Maisons en bande',
    freeLine: 'Ligne libre',
    freePolygon: 'Polygone libre',
  },
  slab: 'Dalle',
  context: 'Bâti existant',
};

export interface IfcExportOptions {
  /** One IfcSpace per storey solid (→ Archicad zones). Default true. */
  spaces?: boolean;
  /** One IfcSlab (floor slab) per storey solid. Default true. */
  slabs?: boolean;
  /** Masses as IfcBuildingElementProxy per mass storey. Default false. */
  massProxies?: boolean;
  /** Context buildings as IfcBuildingElementProxy under the site. Default false. */
  context?: boolean;
  /** Deterministic GlobalIds derived from this seed (e.g. project id); random when absent. */
  guidSeed?: string;
  /** Fixed time (tests); default now. */
  timestamp?: Date;
  labels?: IfcLabels;
  /** Application version written to IfcApplication and the header. */
  appVersion?: string;
}

export const IFC_DEFAULT_OPTIONS = {
  spaces: true,
  slabs: true,
  massProxies: false,
  context: false,
} as const satisfies IfcExportOptions;

interface CrsInfo {
  description: string;
  geodeticDatum: string;
  verticalDatum: string | null;
  projection: string | null;
  zone: string | null;
}

/** Descriptive fields of the projected CRS (only the EPSG name is mandatory for importers). */
export function crsInfo(crs: string): CrsInfo {
  const code = Number(/EPSG:(\d+)/i.exec(crs)?.[1] ?? NaN);
  if (code === 2154)
    return {
      description: 'RGF93 v1 / Lambert-93',
      geodeticDatum: 'RGF93',
      verticalDatum: 'NGF-IGN69',
      projection: 'Lambert Conic Conformal (2SP)',
      zone: null,
    };
  if (code >= 25828 && code <= 25838)
    return {
      description: `ETRS89 / UTM zone ${code - 25800}N`,
      geodeticDatum: 'ETRS89',
      verticalDatum: code === 25832 || code === 25833 ? 'DHHN2016' : null,
      projection: 'UTM',
      zone: `${code - 25800}N`,
    };
  if (code >= 32601 && code <= 32760) {
    const zone = code >= 32701 ? `${code - 32700}S` : `${code - 32600}N`;
    return {
      description: `WGS 84 / UTM zone ${zone}`,
      geodeticDatum: 'WGS84',
      verticalDatum: null,
      projection: 'UTM',
      zone,
    };
  }
  return { description: crs, geodeticDatum: '', verticalDatum: null, projection: null, zone: null };
}

/** Decimal degrees → IfcCompoundPlaneAngleMeasure (deg, min, sec, millionths of sec; same sign). */
export function compoundAngle(deg: number): [number, number, number, number] {
  const sign = deg < 0 ? -1 : 1;
  let micro = Math.round(Math.abs(deg) * 3600 * 1e6);
  const d = Math.floor(micro / 3.6e9);
  micro -= d * 3.6e9;
  const m = Math.floor(micro / 6e7);
  micro -= m * 6e7;
  const s = Math.floor(micro / 1e6);
  micro -= s * 1e6;
  const out = [d, m, s, micro].map((v) => (v === 0 ? 0 : sign * v));
  return out as [number, number, number, number];
}

/** Space name like "BK1-02" (above ground), "BK1-S1" (basement); sections add ".n". */
export function spaceName(massName: string, s: SolidResult['solid']): string {
  const seg = s.segment !== undefined ? `.${s.segment + 1}` : '';
  const idx = s.storeyIndex;
  const st = idx < 0 ? `S${-idx}` : String(idx).padStart(2, '0');
  return `${massName}${seg}-${st}`;
}

function isoTime(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * Export one variant as an IFC4 (ADD2 TC1) STEP file.
 *
 * ```ts
 * import { analyzeProject } from '@kubatur/core';
 * import { exportIfc } from '@kubatur/ifc';
 * const { result } = analyzeProject(project);
 * const text = exportIfc(project, result, { context: true });
 * ```
 *
 * Structure: IfcProject › IfcSite (parcels as FootPrint, RefLatitude/Longitude, IfcMapConversion
 * to the project CRS) › IfcBuilding "{labels.building} – {variant}" › IfcBuildingStorey per
 * project level › IfcSpace per storey solid (aggregated). Slabs / proxies are contained in the
 * storey, context buildings in the site. All geometry is in project-local metres; the local
 * origin maps to `project.geo.originCrs` in the projected CRS.
 */
export function exportIfc(
  project: Project,
  result: VariantResult,
  options: IfcExportOptions = {},
): string {
  const opt = { ...IFC_DEFAULT_OPTIONS, ...options };
  const L = opt.labels ?? IFC_LABELS_FR;
  const now = opt.timestamp ?? new Date();
  const guid = guidFactory(opt.guidSeed);
  const variant =
    project.variants.find((v) => result.masses.every((m) => v.masses.includes(m.mass))) ??
    project.variants.find((v) => v.id === project.activeVariantId);
  const variantName = variant?.name ?? '';
  const w = new StepWriter();

  // --- helpers -----------------------------------------------------------------------------
  const pt3 = (x: number, y: number, z: number) =>
    w.add('IFCCARTESIANPOINT', [list([real(x), real(y), real(z)])]);
  const pt2 = (x: number, y: number) => w.add('IFCCARTESIANPOINT', [list([real(x), real(y)])]);
  const dir = (...v: number[]) => w.add('IFCDIRECTION', [list(v.map(real))]);
  const origin3 = pt3(0, 0, 0);
  const zAxis = dir(0, 0, 1);
  const xAxis = dir(1, 0, 0);
  const placement3 = (x = 0, y = 0, z = 0) =>
    w.add('IFCAXIS2PLACEMENT3D', [x || y || z ? pt3(x, y, z) : origin3, zAxis, xAxis]);
  const localPlacement = (rel: StepRef | null, x = 0, y = 0, z = 0) =>
    w.add('IFCLOCALPLACEMENT', [rel ?? NULL, placement3(x, y, z)]);

  const ring2 = (ring: readonly Vec2[], close = true): StepRef => {
    const pts = ring.map(([x, y]) => pt2(x, y));
    return w.add('IFCPOLYLINE', [list(close ? [...pts, pts[0]!] : pts)]);
  };
  const profile = (poly: Polygon): StepRef => {
    const outer = ring2(poly.outer);
    const holes = (poly.holes ?? []).filter((h) => h.length >= 3);
    return holes.length
      ? w.add('IFCARBITRARYPROFILEDEFWITHVOIDS', [
          enumv('AREA'),
          NULL,
          outer,
          list(holes.map((h) => ring2(h))),
        ])
      : w.add('IFCARBITRARYCLOSEDPROFILEDEF', [enumv('AREA'), NULL, outer]);
  };
  const extrusion = (poly: Polygon, z: number, depth: number): StepRef =>
    w.add('IFCEXTRUDEDAREASOLID', [profile(poly), placement3(0, 0, z), zAxis, real(depth)]);

  // --- header entities ---------------------------------------------------------------------
  const person = w.add('IFCPERSON', [
    NULL,
    str(project.info.author ?? null),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
  ]);
  const org = w.add('IFCORGANIZATION', [
    NULL,
    str(project.info.office ?? 'Kubatur'),
    NULL,
    NULL,
    NULL,
  ]);
  const po = w.add('IFCPERSONANDORGANIZATION', [person, org, NULL]);
  const devOrg = w.add('IFCORGANIZATION', [NULL, str('Kubatur'), NULL, NULL, NULL]);
  const app = w.add('IFCAPPLICATION', [
    devOrg,
    str(opt.appVersion ?? '0.1'),
    str('Kubatur'),
    str('Kubatur'),
  ]);
  const oh = w.add('IFCOWNERHISTORY', [
    po,
    app,
    NULL,
    enumv('NOCHANGE'),
    NULL,
    NULL,
    NULL,
    int(now.getTime() / 1000),
  ]);

  const unit = (type: string, name: string) =>
    w.add('IFCSIUNIT', [DERIVED, enumv(type), NULL, enumv(name)]);
  const metre = unit('LENGTHUNIT', 'METRE');
  const units = w.add('IFCUNITASSIGNMENT', [
    list([
      metre,
      unit('AREAUNIT', 'SQUARE_METRE'),
      unit('VOLUMEUNIT', 'CUBIC_METRE'),
      unit('PLANEANGLEUNIT', 'RADIAN'),
    ]),
  ]);

  const ctx = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [
    NULL,
    str('Model'),
    int(3),
    real(1e-5),
    placement3(),
    w.add('IFCDIRECTION', [list([real(0), real(1)])]),
  ]);
  const sub = (id: string, view: string) =>
    w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', [
      str(id),
      str('Model'),
      DERIVED,
      DERIVED,
      DERIVED,
      DERIVED,
      ctx,
      NULL,
      enumv(view),
      NULL,
    ]);
  const bodyCtx = sub('Body', 'MODEL_VIEW');
  const footCtx = sub('FootPrint', 'MODEL_VIEW');

  const ifcProject = w.add('IFCPROJECT', [
    str(guid('project')),
    oh,
    str(project.name),
    NULL,
    NULL,
    str(project.info.address ?? null),
    str(project.info.phase || null),
    list([ctx]),
    units,
  ]);

  // --- georeferencing ----------------------------------------------------------------------
  const ci = crsInfo(project.geo.crs);
  const projected = w.add('IFCPROJECTEDCRS', [
    str(project.geo.crs.toUpperCase()),
    str(ci.description),
    str(ci.geodeticDatum || null),
    str(ci.verticalDatum),
    str(ci.projection),
    str(ci.zone),
    metre,
  ]);
  // local x = east, y = north → no rotation; z = 0 is ground level (±0,00)
  w.add('IFCMAPCONVERSION', [
    ctx,
    projected,
    real(project.geo.originCrs[0]),
    real(project.geo.originCrs[1]),
    real(project.geo.groundElevation ?? 0),
    NULL,
    NULL,
    NULL,
  ]);

  // --- site --------------------------------------------------------------------------------
  const productShape = (reps: StepRef[]) =>
    w.add('IFCPRODUCTDEFINITIONSHAPE', [NULL, NULL, list(reps)]);
  const footprintRep = (polys: readonly Polygon[]): StepRef =>
    w.add('IFCSHAPEREPRESENTATION', [
      footCtx,
      str('FootPrint'),
      str('GeometricCurveSet'),
      list([
        w.add('IFCGEOMETRICCURVESET', [
          list(polys.flatMap((p) => [p.outer, ...(p.holes ?? [])].map((r) => ring2(r)))),
        ]),
      ]),
    ]);
  const bodyRep = (items: StepRef[]) =>
    w.add('IFCSHAPEREPRESENTATION', [bodyCtx, str('Body'), str('SweptSolid'), list(items)]);

  const parcels = project.site.parcels.length
    ? project.site.parcels.map((p) => p.polygon)
    : project.site.boundary.outer.length
      ? [project.site.boundary]
      : [];
  const sitePlacement = localPlacement(null);
  const [lon, lat] = project.geo.originLonLat;
  const site = w.add('IFCSITE', [
    str(guid('site')),
    oh,
    str(L.site),
    NULL,
    NULL,
    sitePlacement,
    parcels.length ? productShape([footprintRep(parcels)]) : NULL,
    str(
      project.site.parcels
        .map((p) => p.ref)
        .filter(Boolean)
        .join(', ') || null,
    ),
    enumv('ELEMENT'),
    list(compoundAngle(lat).map(int)),
    list(compoundAngle(lon).map(int)),
    real(project.geo.groundElevation ?? 0),
    str(
      project.site.parcels
        .map((p) => p.ref)
        .filter(Boolean)
        .join(', ') || null,
    ),
    NULL,
  ]);
  w.add('IFCRELAGGREGATES', [
    str(guid('rel:project-site')),
    oh,
    NULL,
    NULL,
    ifcProject,
    list([site]),
  ]);

  const buildingPlacement = localPlacement(sitePlacement);
  const building = w.add('IFCBUILDING', [
    str(guid(`building:${variant?.id ?? ''}`)),
    oh,
    str(`${L.building} – ${variantName}`),
    NULL,
    NULL,
    buildingPlacement,
    NULL,
    NULL,
    enumv('ELEMENT'),
    real(project.geo.groundElevation ?? 0),
    NULL,
    NULL,
  ]);
  w.add('IFCRELAGGREGATES', [
    str(guid('rel:site-building')),
    oh,
    NULL,
    NULL,
    site,
    list([building]),
  ]);

  // --- storeys -----------------------------------------------------------------------------
  const levels = [...result.levels].sort((a, b) => a.elevation - b.elevation);
  const storeys = levels.map((lv, i) => {
    const placement = localPlacement(buildingPlacement, 0, 0, lv.elevation);
    const ref = w.add('IFCBUILDINGSTOREY', [
      str(guid(`storey:${lv.elevation.toFixed(3)}`)),
      oh,
      str(lv.name),
      NULL,
      NULL,
      placement,
      NULL,
      NULL,
      enumv('ELEMENT'),
      real(lv.elevation),
    ]);
    return {
      level: lv,
      ref,
      placement,
      index: i,
      spaces: [] as StepRef[],
      elements: [] as StepRef[],
    };
  });
  if (storeys.length)
    w.add('IFCRELAGGREGATES', [
      str(guid('rel:building-storeys')),
      oh,
      NULL,
      NULL,
      building,
      list(storeys.map((s) => s.ref)),
    ]);
  const storeyOf = (z: number) =>
    storeys.reduce((best, s) =>
      Math.abs(s.level.elevation - z) < Math.abs(best.level.elevation - z) ? s : best,
    );

  // --- property helpers --------------------------------------------------------------------
  const prop = (name: string, value: StepToken) =>
    w.add('IFCPROPERTYSINGLEVALUE', [str(name), NULL, value, NULL]);
  const label = (s: string) => typed('IFCLABEL', str(s));
  const pset = (key: string, name: string, objects: StepRef[], props: StepRef[]) => {
    const ps = w.add('IFCPROPERTYSET', [
      str(guid(`pset:${key}`)),
      oh,
      str(name),
      NULL,
      list(props),
    ]);
    w.add('IFCRELDEFINESBYPROPERTIES', [
      str(guid(`rel:pset:${key}`)),
      oh,
      NULL,
      NULL,
      list(objects),
      ps,
    ]);
  };
  const qto = (key: string, name: string, objects: StepRef[], qs: StepRef[]) => {
    const q = w.add('IFCELEMENTQUANTITY', [
      str(guid(`qto:${key}`)),
      oh,
      str(name),
      NULL,
      NULL,
      list(qs),
    ]);
    w.add('IFCRELDEFINESBYPROPERTIES', [
      str(guid(`rel:qto:${key}`)),
      oh,
      NULL,
      NULL,
      list(objects),
      q,
    ]);
  };
  const q = (type: 'LENGTH' | 'AREA' | 'VOLUME', name: string, v: number) =>
    w.add(`IFCQUANTITY${type}`, [str(name), NULL, NULL, real(v), NULL]);

  // --- masses ------------------------------------------------------------------------------
  const solidKey = (m: MassResult, s: SolidResult, i: number) =>
    `${m.mass.id}:${s.solid.segment ?? -1}:${s.solid.storeyIndex}:${i}`;
  if (storeys.length) {
    for (const m of result.masses) {
      m.solids.forEach((sr, i) => {
        const s = sr.solid;
        const st = storeyOf(s.z0);
        const dz = s.z0 - st.level.elevation;
        const h = s.z1 - s.z0;
        const key = solidKey(m, sr, i);
        const name = spaceName(m.mass.name, s);
        const usage = L.usage[s.usage];

        if (opt.spaces) {
          const space = w.add('IFCSPACE', [
            str(guid(`space:${key}`)),
            oh,
            str(name),
            NULL,
            NULL,
            localPlacement(st.placement, 0, 0, dz),
            productShape([bodyRep([extrusion(s.footprint, 0, h)]), footprintRep([s.footprint])]),
            str(usage),
            enumv('ELEMENT'),
            enumv('INTERNAL'),
            NULL,
          ]);
          st.spaces.push(space);
          qto(
            key,
            'Qto_SpaceBaseQuantities',
            [space],
            [
              q('LENGTH', 'Height', h),
              q('AREA', 'GrossFloorArea', sr.areas.bgf),
              q('AREA', 'NetFloorArea', sr.areas.nrf),
              q('VOLUME', 'GrossVolume', sr.areas.bgf * h),
            ],
          );
          pset(
            `common:${key}`,
            'Pset_SpaceCommon',
            [space],
            [
              prop('Reference', typed('IFCIDENTIFIER', str(name))),
              prop('IsExternal', typed('IFCBOOLEAN', bool(false))),
              prop('GrossPlannedArea', typed('IFCAREAMEASURE', real(sr.areas.bgf))),
              prop('NetPlannedArea', typed('IFCAREAMEASURE', real(sr.areas.nrf))),
            ],
          );
          pset(
            `ms:${key}`,
            'Pset_Massenstudie',
            [space],
            [
              prop('Baukörper', label(m.mass.name)),
              prop('Bauform', label(L.typology[m.mass.typology.kind])),
              prop('Nutzung', label(usage)),
              prop('Geschoss', label(s.label)),
              prop('Vollgeschoss', typed('IFCBOOLEAN', bool(sr.fullStorey))),
              prop('Oberirdisch', typed('IFCBOOLEAN', bool(s.aboveGround))),
              prop('Variante', label(variantName)),
              prop('BGF', typed('IFCAREAMEASURE', real(sr.areas.bgf))),
              prop('NUF', typed('IFCAREAMEASURE', real(sr.areas.nuf))),
            ],
          );
        }
        if (opt.massProxies) {
          const proxy = w.add('IFCBUILDINGELEMENTPROXY', [
            str(guid(`proxy:${key}`)),
            oh,
            str(name),
            NULL,
            str(usage),
            localPlacement(st.placement, 0, 0, dz),
            productShape([bodyRep([extrusion(s.footprint, 0, h)])]),
            NULL,
            enumv('ELEMENT'),
          ]);
          st.elements.push(proxy);
        }
        if (opt.slabs) {
          const t = m.mass.storeys.slabThickness;
          const slab = w.add('IFCSLAB', [
            str(guid(`slab:${key}`)),
            oh,
            str(`${L.slab} ${name}`),
            NULL,
            NULL,
            localPlacement(st.placement, 0, 0, dz),
            productShape([bodyRep([extrusion(s.footprint, -t, t)])]),
            NULL,
            enumv('FLOOR'),
          ]);
          st.elements.push(slab);
        }
      });
    }
  }
  for (const st of storeys) {
    if (st.spaces.length)
      w.add('IFCRELAGGREGATES', [
        str(guid(`rel:storey-spaces:${st.index}`)),
        oh,
        NULL,
        NULL,
        st.ref,
        list(st.spaces),
      ]);
    if (st.elements.length)
      w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [
        str(guid(`rel:storey-elements:${st.index}`)),
        oh,
        NULL,
        NULL,
        list(st.elements),
        st.ref,
      ]);
  }

  // --- context -----------------------------------------------------------------------------
  if (opt.context) {
    const ctxElems = project.context
      .filter((b) => !b.hidden && b.footprint.outer.length >= 3 && b.height > (b.baseHeight ?? 0))
      .map((b) => {
        const z0 = b.baseHeight ?? 0;
        return w.add('IFCBUILDINGELEMENTPROXY', [
          str(guid(`context:${b.id}`)),
          oh,
          str(L.context),
          NULL,
          str(b.source),
          localPlacement(sitePlacement),
          productShape([bodyRep([extrusion(b.footprint, z0, b.height - z0)])]),
          str(b.id),
          enumv('USERDEFINED'),
        ]);
      });
    if (ctxElems.length)
      w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [
        str(guid('rel:site-context')),
        oh,
        NULL,
        NULL,
        list(ctxElems),
        site,
      ]);
  }

  return w.toString({
    description: ['ViewDefinition [ReferenceView_V1.2]'],
    name: `${project.name}.ifc`,
    timeStamp: isoTime(now),
    author: project.info.author ? [project.info.author] : [''],
    organization: project.info.office ? [project.info.office] : [''],
    preprocessorVersion: `Kubatur IFC writer ${opt.appVersion ?? '0.1'}`,
    originatingSystem: 'Kubatur',
    schema: 'IFC4',
  });
}
