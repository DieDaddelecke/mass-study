import type { Usage } from '@kubatur/core';
import type { ArchicadCaller } from './bridgeClient';
import {
  categoryName,
  KEY_ITEM,
  KEY_PROJECT,
  KEY_REV,
  LAYER_NAME,
  morphForZone,
  USAGE_COLORS,
  type PlanItem,
  type StorySetting,
  type TransferPlan,
} from './plan';
import {
  isError,
  type AttributeHeader,
  type ElementIdOrError,
  type ElementRef,
  type ErrorItem,
  type GetStoriesResult,
  type GuidRef,
  type MorphData,
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
}

export interface TransferReport {
  created: { zones: number; slabs: number; morphs: number; stairs: number };
  deleted: number;
  /** Zones were refused by Archicad as a whole and replaced by morphs. */
  zoneFallback: boolean;
  /** Zones refused one by one (e.g. overlap) and replaced by morphs. */
  standIns: number;
  errors: { item?: string; message: string }[];
}

export type Progress = (step: string, done: number, total: number) => void;

const CHUNK = 40;
const OWN_TYPES = ['Zone', 'Slab', 'Morph'] as const;

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
  const zoneLayer = await getZoneLayer(c, port);
  return {
    zoneLayer,
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

async function getZoneLayer(
  c: ArchicadCaller,
  port: number,
): Promise<{ guid: string; name: string } | undefined> {
  try {
    const r = await c.call<{ layersOfElementDefaults: (LayerOfDefaults | { error: unknown })[] }>(
      port,
      'GetLayerOfElementDefaults',
      { elementTypes: ['Zone'] },
    );
    const d = r.layersOfElementDefaults[0];
    return d && 'layerId' in d ? { guid: d.layerId.guid, name: d.layerName ?? '' } : undefined;
  } catch {
    return undefined; // older Tapir or bridge
  }
}

async function setZoneLayer(c: ArchicadCaller, port: number, guid: string): Promise<boolean> {
  try {
    const r = await c.call<{ executionResults: { success: boolean }[] }>(
      port,
      'SetLayerOfElementDefaults',
      { layersOfElementDefaults: [{ elementType: 'Zone', layerId: { guid } }] },
    );
    return !!r.executionResults[0]?.success;
  } catch {
    return false;
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
  usages: readonly Usage[],
  usageLabel: (u: Usage) => string,
): Promise<Map<Usage, GuidRef>> {
  const list = async () =>
    (
      await c.call<{ attributes: AttributeHeader[] }>(port, 'GetAttributesByType', {
        attributeType: 'ZoneCategory',
      })
    ).attributes;
  let existing = await list();
  const missing = usages.filter(
    (u) => !existing.some((a) => a.name === categoryName(usageLabel(u))),
  );
  if (missing.length) {
    await c.call(port, 'CreateZoneCategories', {
      zoneCategoryDataArray: missing.map((u) => {
        const [red, green, blue] = USAGE_COLORS[u];
        return {
          name: categoryName(usageLabel(u)),
          categoryCode: `MS-${u}`,
          color: { red, green, blue },
        };
      }),
    });
    existing = await list();
  }
  const map = new Map<Usage, GuidRef>();
  for (const u of usages) {
    const a = existing.find((x) => x.name === categoryName(usageLabel(u)));
    if (a) map.set(u, a.attributeId);
  }
  return map;
}

const ZONE_REFUSED = /Failed to create new Zone/i;
/** Prefix of the error for elements that could not be tagged (and so cannot be replaced later). */
export const TAG_FAILED = 'not tagged:';

/**
 * Executes a plan. Order: layer and categories → (replace) delete our previous elements →
 * create → tag with user data. Never touches the story structure and never deletes
 * elements that do not carry this project's id.
 */
export async function executePlan(
  c: ArchicadCaller,
  port: number,
  plan: TransferPlan,
  ctx: {
    projectId: string;
    mode: 'create' | 'replace';
    usageLabel: (u: Usage) => string;
    rev?: string;
    onProgress?: Progress;
  },
): Promise<TransferReport> {
  const report: TransferReport = {
    created: { zones: 0, slabs: 0, morphs: 0, stairs: 0 },
    deleted: 0,
    zoneFallback: false,
    standIns: 0,
    errors: [],
  };
  const rev = ctx.rev ?? new Date().toISOString();
  const total = plan.items.length;
  let done = 0;
  const progress = (step: string) => ctx.onProgress?.(step, done, total);

  progress('prepare');
  const layer = await ensureLayer(c, port);
  const layerIndex = layer?.index;
  const zones = plan.items.filter((i) => i.kind === 'zone');
  const categories = zones.length
    ? await ensureCategories(c, port, plan.usages, ctx.usageLabel)
    : new Map<Usage, GuidRef>();

  if (ctx.mode === 'replace') {
    progress('delete');
    report.deleted = await removeOwnElements(c, port, ctx.projectId);
  }

  const created: { ref: ElementRef; item: PlanItem; kind: PlanItem['kind'] }[] = [];
  let restoreZoneLayer: string | undefined;
  const collect = (items: PlanItem[], res: ElementIdOrError[], kind: PlanItem['kind']) => {
    res.forEach((r, i) => {
      const item = items[i]!;
      if (isError(r))
        report.errors.push({
          item: `${item.massName} ${item.storeyLabel}`,
          message: r.error.message,
        });
      else created.push({ ref: r, item, kind });
    });
  };

  // zones: Tapir 2.0 cannot give zones a layer, they take the zone tool's default layer.
  // When that layer is hidden or locked (office templates), Archicad refuses to tag,
  // move or delete them. So the default is switched to our layer only while zones are
  // created, and then restored.
  const refusedZones: PlanItem[] = [];
  let zoneLayerSet = false;
  if (zones.length && layer) {
    const before = await getZoneLayer(c, port);
    if (before && before.guid !== layer.attributeId.guid) {
      zoneLayerSet = await setZoneLayer(c, port, layer.attributeId.guid);
      if (zoneLayerSet) restoreZoneLayer = before.guid;
    } else zoneLayerSet = !!before;
  }
  try {
    for (const part of chunks(zones)) {
      progress('zones');
      const res = await c.call<{ elements: ElementIdOrError[] }>(port, 'CreateZones', {
        zonesData: part.map((i) => {
          const cat = categories.get(i.usage);
          return { ...i.zone!, ...(cat ? { categoryAttributeId: cat } : {}) };
        }),
      });
      res.elements.forEach((r, k) => {
        const item = part[k]!;
        if (isError(r)) {
          refusedZones.push(item);
          if (!ZONE_REFUSED.test(r.error.message))
            report.errors.push({
              item: `${item.massName} ${item.storeyLabel}`,
              message: r.error.message,
            });
        } else created.push({ ref: r, item, kind: 'zone' });
      });
      done += part.length;
    }
  } finally {
    if (restoreZoneLayer) await setZoneLayer(c, port, restoreZoneLayer);
  }
  report.zoneFallback = zones.length > 0 && refusedZones.length === zones.length;

  // slabs
  const slabs = plan.items.filter((i) => i.kind === 'slab');
  for (const part of chunks(slabs)) {
    progress('slabs');
    const res = await c.call<{ elements: ElementIdOrError[] }>(port, 'CreateSlabs', {
      slabsData: part.map((i) => ({ ...i.slab!, ...(layerIndex ? { layerIndex } : {}) })),
    });
    collect(part, res.elements, 'slab');
    done += part.length;
  }

  // morphs (+ stand-ins for refused zones when morphs are not already planned for them)
  const morphs = plan.items.filter((i) => i.kind === 'morph');
  const planned = new Set(morphs.map((m) => m.key.replace(/\|morph$/, '')));
  const standIns: PlanItem[] = refusedZones
    .filter((z) => !planned.has(z.key.replace(/\|zone$/, '')))
    .map((z) => ({
      ...z,
      kind: 'morph' as const,
      key: z.key.replace(/\|zone$/, '|morph'),
      morph: morphForZone(z)!,
    }));
  report.standIns = report.zoneFallback ? 0 : standIns.length;
  const allMorphs = [...morphs, ...standIns];
  for (const part of chunks(allMorphs)) {
    progress('morphs');
    const res = await c.call<{ elements: ElementIdOrError[] }>(port, 'CreateMorphs', {
      morphsData: part.map((i): MorphData => ({
        ...i.morph!,
        ...(layerIndex ? { layerIndex } : {}),
      })),
    });
    collect(part, res.elements, 'morph');
    done += part.length;
  }

  // stairs: flights and landings as morphs
  const stairs = plan.items.filter((i) => i.kind === 'stair');
  for (const part of chunks(stairs)) {
    progress('stairs');
    const res = await c.call<{ elements: ElementIdOrError[] }>(port, 'CreateMorphs', {
      morphsData: part.map((i): MorphData => ({
        ...i.morph!,
        ...(layerIndex ? { layerIndex } : {}),
      })),
    });
    collect(part, res.elements, 'stair');
    done += part.length;
  }

  // tags + layer for zones
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
            {
              key: KEY_ITEM,
              value: x.item.key.replace(/\|(zone|morph|slab|stair)$/, `|${x.kind}`),
            },
            { key: KEY_REV, value: rev },
          ],
        })),
      },
    );
    (r.executionResults ?? []).forEach((x, i) => {
      if (x.success) return;
      const it = part[i]!;
      report.errors.push({
        item: `${it.item.massName} ${it.item.storeyLabel}`,
        message: `${TAG_FAILED} ${x.error?.message ?? ''}`.trim(),
      });
    });
  }
  const createdZones = created.filter((x) => x.kind === 'zone');
  if (layerIndex && createdZones.length && !zoneLayerSet)
    for (const part of chunks(createdZones, 200))
      await c
        .call(port, 'SetDetailsOfElements', {
          elementsWithDetails: part.map((x) => ({
            elementId: x.ref.elementId,
            details: { layerIndex },
          })),
        })
        .catch((e: unknown) => report.errors.push({ message: `layer: ${String(e)}` }));

  for (const x of created)
    if (x.kind !== 'stair') report.created[`${x.kind}s` as 'zones' | 'slabs' | 'morphs']++;
  // a stair counts once (its flights and landing are separate morphs)
  report.created.stairs = new Set(
    created.filter((x) => x.kind === 'stair').map((x) => x.item.key.replace(/[fl]\d+\|/, '|')),
  ).size;
  done = total;
  progress('done');
  return report;
}
