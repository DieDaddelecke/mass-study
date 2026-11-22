import type { ArchicadCaller } from './bridgeClient';
import {
  KEY_ITEM,
  KEY_PROJECT,
  KEY_REV,
  LAYER_NAME,
  morphForZone,
  type PlanItem,
  type StorySetting,
  type TransferPlan,
  type ZoneCategoryDef,
} from './plan';
import {
  isError,
  type AttributeHeader,
  type ElementIdOrError,
  type ElementRef,
  type ErrorItem,
  type GetStoriesResult,
  type GuidRef,
  type TapirLibrary,
  type TapirStory,
} from './tapir';

/** Archicad state read before planning (read-only calls only). */
export interface ArchicadSnapshot {
  stories: TapirStory[];
  libraries: TapirLibrary[];
  isUntitled: boolean;
  isTeamwork: boolean;
  projectName?: string;
  /** Elements Kubatur created earlier for this project (any revision). */
  ownElements: number;
  /** Layer of the zone tool defaults; new zones land there (Tapir 2.0 has no layerIndex for zones). */
  zoneLayer?: { guid: string; name: string };
  /**
   * Zone stamps (library parts of type "Room") Archicad can load. 0 means every zone is refused
   * ("Failed to create new Zone"), typically an office template whose stamp library is missing.
   * Undefined when the bridge or Tapir cannot tell.
   */
  zoneStamps?: number;
  /** A loaded zone stamp, given to the zone categories Kubatur creates. */
  zoneStamp?: ZoneStamp;
}

export interface ZoneStamp {
  name: string;
  mainGuid: string;
  revGuid: string;
}

export interface TransferReport {
  created: {
    zones: number;
    sdpZones: number;
    walls: number;
    slabs: number;
    roofs: number;
    morphs: number;
    stairs: number;
  };
  /** Stairs Archicad refused, created as morphs (flights and landing) instead. */
  stairFallbacks: number;
  deleted: number;
  /** Zones were refused by Archicad as a whole and replaced by morphs. */
  zoneFallback: boolean;
  /** Zones refused one by one (e.g. overlap) and replaced by morphs. */
  standIns: number;
  errors: { item?: string; message: string }[];
}

export type Progress = (step: string, done: number, total: number) => void;

const CHUNK = 40;
const OWN_TYPES = ['Zone', 'Slab', 'Morph', 'Wall', 'Roof', 'Stair'] as const;
/** Element types without layerIndex in Tapir 2.0.0: their tool default layer is switched instead. */
type DefaultLayerType = 'Zone' | 'Stair' | 'Roof';

function chunks<T>(a: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

export async function readSnapshot(
  c: ArchicadCaller,
  port: number,
  projectId: string,
): Promise<ArchicadSnapshot> {
  const [stories, libs, info] = await Promise.all([
    c.call<GetStoriesResult>(port, 'GetStories'),
    c.call<{ libraries: TapirLibrary[] }>(port, 'GetLibraries').catch(() => ({ libraries: [] })),
    c.call<{ isUntitled?: boolean; isTeamwork?: boolean; projectName?: string }>(
      port,
      'GetProjectInfo',
    ),
  ]);
  const own = await findOwnElements(c, port, projectId);
  const zoneLayer = await getDefaultLayer(c, port, 'Zone');
  const stamps = await findZoneStamps(c, port);
  return {
    zoneLayer,
    ...stamps,
    stories: stories.stories,
    libraries: libs.libraries,
    isUntitled: !!info.isUntitled,
    isTeamwork: !!info.isTeamwork,
    projectName: info.projectName,
    ownElements: own.length,
  };
}

interface LayerOfDefaults {
  elementType: string;
  layerId: GuidRef;
  layerName?: string;
}

async function getDefaultLayer(
  c: ArchicadCaller,
  port: number,
  elementType: DefaultLayerType,
): Promise<{ guid: string; name: string } | undefined> {
  try {
    const r = await c.call<{ layersOfElementDefaults: (LayerOfDefaults | { error: unknown })[] }>(
      port,
      'GetLayerOfElementDefaults',
      { elementTypes: [elementType] },
    );
    const d = r.layersOfElementDefaults[0];
    return d && 'layerId' in d ? { guid: d.layerId.guid, name: d.layerName ?? '' } : undefined;
  } catch {
    return undefined; // older Tapir or bridge
  }
}

async function setDefaultLayer(
  c: ArchicadCaller,
  port: number,
  elementType: DefaultLayerType,
  guid: string,
): Promise<boolean> {
  try {
    const r = await c.call<{ executionResults: { success: boolean }[] }>(
      port,
      'SetLayerOfElementDefaults',
      { layersOfElementDefaults: [{ elementType, layerId: { guid } }] },
    );
    return !!r.executionResults[0]?.success;
  } catch {
    return false;
  }
}

/** Splits a library part unique ID "{main}-{rev}" into its two GUIDs (with braces). */
export function splitUnId(unId: string): { mainGuid: string; revGuid: string } | null {
  const hex = unId.replace(/[{}]/g, '');
  const m = /^([0-9a-f-]{36})-([0-9a-f-]{36})$/i.exec(hex);
  return m ? { mainGuid: `{${m[1]!.toUpperCase()}}`, revGuid: `{${m[2]!.toUpperCase()}}` } : null;
}

/** Zone stamps Archicad can load (GetAvailableLibraryParts, type "Room"). */
async function findZoneStamps(
  c: ArchicadCaller,
  port: number,
): Promise<{ zoneStamps?: number; zoneStamp?: ZoneStamp }> {
  try {
    const r = await c.call<{
      libraryParts: { guid?: string; documentName?: string }[];
      skippedCount?: number;
    }>(port, 'GetAvailableLibraryParts', { filterByTypeId: 'Room' });
    const parts = r.libraryParts.filter((p) => p.guid && p.documentName);
    const pick =
      parts.find((p) => /marque de zone|zone stamp|zonenstempel/i.test(p.documentName!)) ??
      parts[0];
    const ids = pick && splitUnId(pick.guid!);
    return {
      zoneStamps: parts.length,
      ...(pick && ids ? { zoneStamp: { name: pick.documentName!, ...ids } } : {}),
    };
  } catch {
    return {}; // older Tapir or bridge
  }
}

/**
 * Replaces the Archicad story structure (Tapir SetStories). Only for test projects:
 * the bridge refuses it unless the open project is untitled.
 */
export async function applyStories(
  c: ArchicadCaller,
  port: number,
  stories: readonly StorySetting[],
): Promise<void> {
  await c.call(port, 'SetStories', { stories });
}

/** Elements carrying our project id in their Tapir user data. */
export async function findOwnElements(
  c: ArchicadCaller,
  port: number,
  projectId: string,
): Promise<ElementRef[]> {
  const all: ElementRef[] = [];
  for (const elementType of OWN_TYPES) {
    const r = await c.call<{ elements?: ElementRef[] }>(port, 'GetElementsByType', { elementType });
    for (const e of r.elements ?? [])
      if (e && 'elementId' in e) all.push({ elementId: e.elementId });
  }
  const own: ElementRef[] = [];
  for (const part of chunks(all, 200)) {
    const r = await c.call<{
      elementUserData: ({ userData: { key: string; value: string }[] } | { error: unknown })[];
    }>(port, 'GetElementUserData', { elements: part, keys: [KEY_PROJECT] });
    r.elementUserData.forEach((d, i) => {
      if ('userData' in d && d.userData.some((p) => p.key === KEY_PROJECT && p.value === projectId))
        own.push(part[i]!);
    });
  }
  return own;
}

export async function removeOwnElements(
  c: ArchicadCaller,
  port: number,
  projectId: string,
): Promise<number> {
  const own = await findOwnElements(c, port, projectId);
  let deleted = 0;
  for (const part of chunks(own, 200)) {
    const r = await c.call<{ executionResults: { success: boolean }[] }>(port, 'DeleteElements', {
      elements: part,
    });
    deleted += r.executionResults.filter((x) => x.success).length;
  }
  return deleted;
}

async function ensureLayer(c: ArchicadCaller, port: number): Promise<AttributeHeader | undefined> {
  const find = async () =>
    (
      await c.call<{ attributes: AttributeHeader[] }>(port, 'GetAttributesByType', {
        attributeType: 'Layer',
      })
    ).attributes.find((a) => a.name === LAYER_NAME);
  let layer = await find();
  if (!layer) {
    await c.call(port, 'CreateLayers', { layerDataArray: [{ name: LAYER_NAME }] });
    layer = await find();
  }
  return layer;
}

async function ensureCategories(
  c: ArchicadCaller,
  port: number,
  defs: readonly ZoneCategoryDef[],
  stamp?: ZoneStamp,
): Promise<Map<string, GuidRef>> {
  const list = async () =>
    (
      await c.call<{ attributes: AttributeHeader[] }>(port, 'GetAttributesByType', {
        attributeType: 'ZoneCategory',
      })
    ).attributes;
  let existing = await list();
  const missing = defs.filter((d) => !existing.some((a) => a.name === d.name));
  if (missing.length) {
    await c.call(port, 'CreateZoneCategories', {
      zoneCategoryDataArray: missing.map((d) => {
        const [red, green, blue] = d.color;
        return {
          name: d.name,
          categoryCode: d.code,
          color: { red, green, blue },
          ...(stamp
            ? {
                stampName: stamp.name,
                stampMainGuid: stamp.mainGuid,
                stampRevGuid: stamp.revGuid,
              }
            : {}),
        };
      }),
    });
    existing = await list();
  }
  const map = new Map<string, GuidRef>();
  for (const d of defs) {
    const a = existing.find((x) => x.name === d.name);
    if (a) map.set(d.name, a.attributeId);
  }
  return map;
}

const ZONE_REFUSED = /Failed to create new Zone/i;
/** Prefix of the error for elements that could not be tagged (and so cannot be replaced later). */
export const TAG_FAILED = 'not tagged:';

/**
 * Executes a plan. Order: layer and categories → (replace) delete our previous elements →
 * slabs, walls, roofs, stairs, zones (dwellings first, then the overlapping SDP zones), volumes
 * → tag with user data. Never touches the story structure and never deletes elements that do
 * not carry this project's id.
 */
export async function executePlan(
  c: ArchicadCaller,
  port: number,
  plan: TransferPlan,
  ctx: {
    projectId: string;
    mode: 'create' | 'replace';
    rev?: string;
    /** Loaded zone stamp for new zone categories (from the snapshot). */
    zoneStamp?: ZoneStamp;
    onProgress?: Progress;
  },
): Promise<TransferReport> {
  const report: TransferReport = {
    created: { zones: 0, sdpZones: 0, walls: 0, slabs: 0, roofs: 0, morphs: 0, stairs: 0 },
    stairFallbacks: 0,
    deleted: 0,
    zoneFallback: false,
    standIns: 0,
    errors: [],
  };
  const rev = ctx.rev ?? new Date().toISOString();
  const total = plan.items.length;
  let done = 0;
  const progress = (step: string) => ctx.onProgress?.(step, done, total);
  const of = (k: PlanItem['kind']) => plan.items.filter((i) => i.kind === k);
  const label = (i: PlanItem) => `${i.massName} ${i.storeyLabel}`.trim();

  progress('prepare');
  const layer = await ensureLayer(c, port);
  const layerIndex = layer?.index;
  const zones = of('zone');
  const categories = zones.length
    ? await ensureCategories(c, port, plan.categories, ctx.zoneStamp)
    : new Map<string, GuidRef>();

  if (ctx.mode === 'replace') {
    progress('delete');
    report.deleted = await removeOwnElements(c, port, ctx.projectId);
  }

  /** created element → its tag (item key) and what it counts as */
  const created: {
    ref: ElementRef;
    item: PlanItem;
    key: string;
    count?: keyof TransferReport['created'];
  }[] = [];
  const withLayer = <T extends object>(x: T): T => (layerIndex ? { ...x, layerIndex } : x);

  /** Creates items in chunks; refused items go to `onRefused` (or into the errors). */
  const run = async <T>(
    step: string,
    command: string,
    field: string,
    items: PlanItem[],
    data: (i: PlanItem) => T,
    count: keyof TransferReport['created'] | undefined,
    onRefused?: (i: PlanItem, message: string) => void,
  ) => {
    for (const part of chunks(items)) {
      progress(step);
      const res = await c.call<{ elements: ElementIdOrError[] }>(port, command, {
        [field]: part.map(data),
      });
      res.elements.forEach((r, k) => {
        const item = part[k]!;
        if (isError(r)) {
          if (onRefused) onRefused(item, r.error.message);
          else report.errors.push({ item: label(item), message: r.error.message });
        } else created.push({ ref: r, item, key: item.key, ...(count ? { count } : {}) });
      });
      done += part.length;
    }
  };

  // Zones, stairs and roofs have no layerIndex in Tapir 2.0.0; they take their tool's default
  // layer, which in office templates is often hidden or locked (Archicad then refuses to tag,
  // move or delete them). So the defaults are switched to our layer while we create, then restored.
  const restore: [DefaultLayerType, string][] = [];
  const needed = new Set<DefaultLayerType>([
    ...(zones.length ? (['Zone'] as const) : []),
    ...(of('stair').some((i) => i.stair) ? (['Stair'] as const) : []),
    ...(of('roof').length ? (['Roof'] as const) : []),
  ]);
  const layerSet = new Set<DefaultLayerType>();
  if (layer)
    for (const t of needed) {
      const before = await getDefaultLayer(c, port, t);
      if (before && before.guid !== layer.attributeId.guid) {
        if (await setDefaultLayer(c, port, t, layer.attributeId.guid)) {
          restore.push([t, before.guid]);
          layerSet.add(t);
        }
      } else if (before) layerSet.add(t);
    }

  const refusedZones: PlanItem[] = [];
  try {
    await run('slabs', 'CreateSlabs', 'slabsData', of('slab'), (i) => withLayer(i.slab!), 'slabs');
    await run('walls', 'CreateWalls', 'wallsData', of('wall'), (i) => withLayer(i.wall!), 'walls');
    await run('roofs', 'CreateRoofs', 'roofsData', of('roof'), (i) => i.roof!, 'roofs');

    // stairs: native; a refused stair (or one without a native form) becomes morphs
    const stairs = of('stair');
    const fallbacks: PlanItem[] = stairs.filter((i) => !i.stair);
    await run(
      'stairs',
      'CreateStairs',
      'stairsData',
      stairs.filter((i) => i.stair),
      (i) => i.stair!,
      'stairs',
      (i) => fallbacks.push(i),
    );
    const parts = fallbacks.flatMap((i) =>
      (i.fallback ?? []).map((m, k) => ({
        ...i,
        kind: 'morph' as const,
        key: `${i.key}#${k}`,
        morph: m,
      })),
    );
    if (parts.length) {
      const before = created.length;
      await run(
        'stairs',
        'CreateMorphs',
        'morphsData',
        parts,
        (i) => withLayer(i.morph!),
        undefined,
      );
      const stairsMade = new Set(created.slice(before).map((x) => x.key.replace(/#\d+$/, '')));
      report.stairFallbacks = stairsMade.size;
      report.created.stairs += stairsMade.size;
    }

    // zones: dwellings, cores, circulation first; the SDP zones overlap them afterwards
    const zoneData = (i: PlanItem) => {
      const cat = i.category && categories.get(i.category.name);
      return { ...i.zone!, ...(cat ? { categoryAttributeId: cat } : {}) };
    };
    const onZoneRefused = (i: PlanItem, message: string) => {
      refusedZones.push(i);
      if (!ZONE_REFUSED.test(message)) report.errors.push({ item: label(i), message });
    };
    await run(
      'zones',
      'CreateZones',
      'zonesData',
      zones.filter((i) => i.role !== 'sdp'),
      zoneData,
      'zones',
      onZoneRefused,
    );
    await run(
      'zones',
      'CreateZones',
      'zonesData',
      zones.filter((i) => i.role === 'sdp'),
      zoneData,
      'sdpZones',
      onZoneRefused,
    );
  } finally {
    for (const [t, guid] of restore) await setDefaultLayer(c, port, t, guid);
  }
  report.zoneFallback = zones.length > 0 && refusedZones.length === zones.length;

  // volumes, plus a volume for every refused SDP zone (the storey would be missing otherwise)
  const morphs = of('morph');
  const planned = new Set(morphs.map((m) => m.key.replace(/\|morph$/, '')));
  const standIns: PlanItem[] = refusedZones
    .filter((z) => z.role === 'sdp' && !planned.has(z.key.replace(/\|sdp\|zone$/, '')))
    .map((z) => ({
      ...z,
      kind: 'morph' as const,
      key: z.key.replace(/\|sdp\|zone$/, '|morph'),
      morph: morphForZone(z)!,
    }));
  report.standIns = standIns.length;
  await run(
    'morphs',
    'CreateMorphs',
    'morphsData',
    [...morphs, ...standIns],
    (i) => withLayer(i.morph!),
    'morphs',
  );

  // tags
  progress('tag');
  for (const part of chunks(created, 200)) {
    const r = await c.call<{ executionResults?: ({ success: boolean } & Partial<ErrorItem>)[] }>(
      port,
      'SetElementUserData',
      {
        elementUserData: part.map((x) => ({
          elementId: x.ref.elementId,
          userData: [
            { key: KEY_PROJECT, value: ctx.projectId },
            { key: KEY_ITEM, value: x.key },
            { key: KEY_REV, value: rev },
          ],
        })),
      },
    );
    (r.executionResults ?? []).forEach((x, i) => {
      if (x.success) return;
      report.errors.push({
        item: label(part[i]!.item),
        message: `${TAG_FAILED} ${x.error?.message ?? ''}`.trim(),
      });
    });
  }
  // elements of types whose default layer could not be switched: move them onto our layer
  const typeOf: Partial<Record<PlanItem['kind'], DefaultLayerType>> = {
    zone: 'Zone',
    stair: 'Stair',
    roof: 'Roof',
  };
  const stray = created.filter((x) => {
    const t = typeOf[x.item.kind];
    return t && !layerSet.has(t) && !x.key.includes('#');
  });
  if (layerIndex && stray.length)
    for (const part of chunks(stray, 200))
      await c
        .call(port, 'SetDetailsOfElements', {
          elementsWithDetails: part.map((x) => ({
            elementId: x.ref.elementId,
            details: { layerIndex },
          })),
        })
        .catch((e: unknown) => report.errors.push({ message: `layer: ${String(e)}` }));

  for (const x of created) if (x.count) report.created[x.count]++;
  done = total;
  progress('done');
  return report;
}
