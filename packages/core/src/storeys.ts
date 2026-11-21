import { typologySegments, toWorld } from './generators.js';
import { intersection, offsetPolygons, ringBBox, rect } from './geometry.js';
import type {
  Mass,
  Polygon,
  Settings,
  StoreyNotation,
  StoreySolid,
  StoreyStack,
  TerraceStep,
  Usage,
} from './types.js';

const ROMAN = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
];

export function toRoman(n: number): string {
  return ROMAN[n] ?? String(n);
}

/** Merge a partial stack (section override) into a full one. */
export function mergeStack(base: StoreyStack, o?: Partial<StoreyStack>): StoreyStack {
  if (!o) return base;
  return {
    ...base,
    ...o,
    basement: { ...base.basement, ...o.basement },
    ground: { ...base.ground, ...o.ground },
    upper: { ...base.upper, ...o.upper },
  };
}

export interface StoreyDef {
  index: number;
  height: number;
  z0: number;
  setback: boolean;
}

/** Storey list (bottom to top) with absolute finished-floor levels. ±0,00 = ground floor. */
export function storeyDefs(stack: StoreyStack): StoreyDef[] {
  const override = new Map((stack.heightOverrides ?? []).map((o) => [o.index, o.height]));
  const heightOf = (i: number): number =>
    override.get(i) ??
    (i < 0 ? stack.basement.height : i === 0 ? stack.ground.height : stack.upper.height);
  const setbackCount = Math.min(stack.setback?.storeys ?? 0, stack.upper.count);
  const defs: StoreyDef[] = [];
  // basements, top-down from 0
  let z = 0;
  const below: StoreyDef[] = [];
  for (let i = -1; i >= -stack.basement.count; i--) {
    const h = heightOf(i);
    z -= h;
    below.unshift({ index: i, height: h, z0: z, setback: false });
  }
  defs.push(...below);
  z = 0;
  for (let i = 0; i <= stack.upper.count; i++) {
    const h = heightOf(i);
    defs.push({ index: i, height: h, z0: z, setback: i > stack.upper.count - setbackCount });
    z += h;
  }
  return defs;
}

export function storeyLabel(
  index: number,
  notation: StoreyNotation,
  setback: boolean,
  basementCount = 1,
): string {
  if (notation === 'fr') {
    if (index < 0) return basementCount > 1 ? `SS${-index}` : 'SS';
    if (index === 0) return 'RDC';
    return setback ? `R+${index} (attique)` : `R+${index}`;
  }
  if (notation === 'roman') {
    if (index < 0) return basementCount > 1 ? `${-index}.UG` : 'UG';
    if (index === 0) return 'I';
    return setback ? 'S' : toRoman(index + 1);
  }
  if (index < 0) return basementCount > 1 ? `${-index}.UG` : 'UG';
  if (index === 0) return 'EG';
  return setback ? 'SG' : `${index}.OG`;
}

/** Short storey formula of a stack, e.g. "R+4+C", "EG + 3 OG + SG", "IV + S". */
export function storeyFormula(stack: StoreyStack, notation: StoreyNotation): string {
  const sb = Math.min(stack.setback?.storeys ?? 0, stack.upper.count);
  const regular = stack.upper.count - sb;
  const ug = stack.basement.count;
  if (notation === 'fr') {
    let s = `R+${regular}`;
    if (sb) s += sb > 1 ? `+${sb}C` : '+C';
    if (ug) s = `${ug > 1 ? ug : ''}SS+${s}`;
    return s;
  }
  if (notation === 'roman') {
    let s = toRoman(regular + 1);
    if (sb) s += sb > 1 ? ` + ${sb} S` : ' + S';
    return s;
  }
  const parts = [];
  if (ug) parts.push(ug > 1 ? `${ug} UG` : 'UG');
  parts.push('EG');
  if (regular) parts.push(`${regular} OG`);
  if (sb) parts.push(sb > 1 ? `${sb} SG` : 'SG');
  return parts.join(' + ');
}

function defaultUsage(mass: Mass, index: number): Usage {
  const explicit = mass.usageByStorey?.[index];
  if (explicit) return explicit;
  if (index < 0) return 'parken';
  return mass.usage ?? 'wohnen';
}

/** Active terrace step of a storey (the step with the highest `fromStorey` ≤ index), if any. */
export function terraceStepFor(stack: StoreyStack, index: number): TerraceStep | undefined {
  if (index < 1) return undefined;
  let best: TerraceStep | undefined;
  for (const t of stack.terraces ?? [])
    if (t.fromStorey >= 1 && t.fromStorey <= index && (!best || t.fromStorey > best.fromStorey))
      best = t;
  return best;
}

/** Apply a setback to a local footprint (front = −y, back = +y, left = −x, right = +x). */
export function applySetback(
  local: Polygon,
  distance: NonNullable<StoreyStack['setback']>['distance'],
): Polygon[] {
  if (typeof distance === 'number') return offsetPolygons([local], -distance);
  const bb = ringBBox(local.outer);
  const clip = rect(
    bb.minX + distance.left,
    bb.minY + distance.front,
    bb.maxX - distance.right,
    bb.maxY - distance.back,
  );
  if (clip.outer[0]![0] >= clip.outer[1]![0] || clip.outer[0]![1] >= clip.outer[2]![1]) return [];
  return intersection([local], [clip]);
}

/**
 * Central derivation: one StoreySolid per mass, section and storey.
 * Pure and deterministic.
 */
export function massToSolids(mass: Mass, settings: Pick<Settings, 'notation'>): StoreySolid[] {
  const out: StoreySolid[] = [];
  for (const seg of typologySegments(mass.typology)) {
    const stack = mergeStack(
      mass.storeys,
      seg.segment !== undefined ? mass.segmentOverrides?.[seg.segment] : undefined,
    );
    const defs = storeyDefs(stack);
    const topIndex = defs[defs.length - 1]?.index;
    const cache = new Map<string, Polygon[]>();
    const footprintsOf = (d: StoreyDef): Polygon[] => {
      const step = terraceStepFor(stack, d.index);
      const key = `${step ? step.fromStorey : '-'}|${d.setback ? 1 : 0}`;
      let polys = cache.get(key);
      if (polys) return polys;
      polys = step ? applySetback(seg.local, step.distance) : [seg.local];
      if (d.setback && stack.setback && stack.setback.storeys > 0) {
        // both measured from the full footprint
        const attique = applySetback(seg.local, stack.setback.distance);
        polys = step ? intersection(polys, attique) : attique;
      }
      cache.set(key, polys);
      return polys;
    };
    for (const d of defs) {
      const locals = footprintsOf(d);
      for (const local of locals) {
        const solid: StoreySolid = {
          massId: mass.id,
          storeyIndex: d.index,
          label: storeyLabel(d.index, settings.notation, d.setback, stack.basement.count),
          footprint: toWorld(mass, local),
          z0: d.z0,
          z1: d.z0 + d.height,
          usage: defaultUsage(mass, d.index),
          aboveGround: d.index >= 0,
          setback: d.setback,
          top: d.index === topIndex,
        };
        if (seg.segment !== undefined) solid.segment = seg.segment;
        out.push(solid);
      }
    }
  }
  return out;
}

/** Height of the top of a mass/section (finished floor of top storey + storey height + parapet). */
export function solidsTopHeight(solids: readonly StoreySolid[], parapet: number): number {
  const tops = solids.filter((s) => s.aboveGround).map((s) => s.z1);
  return tops.length ? Math.max(...tops) + parapet : 0;
}

export interface ProjectLevel {
  elevation: number;
  name: string;
}

/**
 * Project levels = union of all finished-floor levels (within tolerance), auto-named.
 * Used for elevations/sections and as the Archicad / IFC storey structure.
 */
export function projectLevels(
  solids: readonly StoreySolid[],
  settings: Pick<Settings, 'levelTolerance' | 'notation'>,
): ProjectLevel[] {
  const groups: { z: number[]; labels: string[] }[] = [];
  for (const s of [...solids].sort((a, b) => a.z0 - b.z0)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(s.z0 - g.z[0]!) <= settings.levelTolerance) {
      g.z.push(s.z0);
      g.labels.push(s.label);
    } else groups.push({ z: [s.z0], labels: [s.label] });
  }
  const levels = groups.map((g) => {
    const elevation = Math.round((g.z.reduce((a, b) => a + b, 0) / g.z.length) * 1000) / 1000;
    const labels = new Set(g.labels);
    return { elevation, name: labels.size === 1 ? [...labels][0]! : '' };
  });
  // names must be unique: ambiguous or duplicated labels fall back to the elevation
  const count = new Map<string, number>();
  for (const l of levels) count.set(l.name, (count.get(l.name) ?? 0) + 1);
  const prefix = settings.notation === 'fr' ? 'Niveau' : 'Ebene';
  return levels.map((l) =>
    !l.name || (count.get(l.name) ?? 0) > 1
      ? { ...l, name: `${prefix} ${formatLevel(l.elevation)}` }
      : l,
  );
}

export function formatLevel(z: number): string {
  if (Math.abs(z) < 0.0005) return '±0,00';
  const s = Math.abs(z).toFixed(2).replace('.', ',');
  return (z > 0 ? '+' : '-') + s;
}
