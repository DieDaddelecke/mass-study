/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed test double */
import type { ArchicadCaller } from './bridgeClient';
import type { TapirStory } from './tapir';

/**
 * In-memory stand-in for bridge + Archicad, mirroring tools/archicad-bridge/mock_archicad.py
 * (same commands, same shapes, same "kubatur.projectId" guard on deletes). For tests only.
 */
export class FakeArchicad implements ArchicadCaller {
  elements = new Map<
    string,
    { type: string; data?: unknown; details?: Record<string, unknown>; layer?: string }
  >();
  userData = new Map<string, Record<string, string>>();
  attributes: Record<string, { attributeId: { guid: string }; index: number; name: string }[]> = {
    Layer: [
      { attributeId: { guid: 'L-1' }, index: 1, name: 'Calque Archicad' },
      { attributeId: { guid: 'L-Z' }, index: 2, name: '8 - ZONES_SDP' },
    ],
    ZoneCategory: [{ attributeId: { guid: 'C-1' }, index: 1, name: 'Zone' }],
  };
  log: string[] = [];
  /** Data of the zone categories created (stamp fields). */
  categoryData: any[] = [];
  refuseZones = false;
  /** Refuse every stair (to test the morph fallback). */
  refuseStairs = false;
  /** Tool default layers (guid) of the tools without layerIndex in Tapir 2.0.0. */
  defaultLayers: Record<string, string> = { Zone: 'L-Z', Stair: 'L-Z', Roof: 'L-Z' };
  get zoneDefaultLayer() {
    return this.defaultLayers.Zone!;
  }
  set zoneDefaultLayer(g: string) {
    this.defaultLayers.Zone = g;
  }
  /** Hidden layers: elements on them cannot be tagged, changed or deleted. */
  hiddenLayers = new Set<string>(['L-Z']);
  /** Untitled (test) project: SetStories allowed. */
  untitled = true;
  private n = 0;

  constructor(
    public stories: TapirStory[] = [
      { index: -1, name: 'R-1', level: -3 },
      { index: 0, name: 'RDC', level: 0 },
      { index: 1, name: 'R+1', level: 3.5 },
      { index: 2, name: 'R+2', level: 6.5 },
      { index: 3, name: 'R+3', level: 9.5 },
      { index: 4, name: 'R+4', level: 12.5 },
      { index: 5, name: 'R+5', level: 15.5 },
    ],
  ) {}

  private guid() {
    return `G-${++this.n}`;
  }

  addForeign(type: string): string {
    const g = this.guid();
    this.elements.set(g, { type });
    return g;
  }

  async call<T>(_port: number, command: string, p: any = {}): Promise<T> {
    this.log.push(command);
    const r = this.handle(command, p);
    return r as T;
  }

  private create(type: string, items: any[], check: (x: any) => string | null) {
    return {
      elements: items.map((it) => {
        const err = check(it);
        if (err) return { error: { code: -2130313112, message: err } };
        const g = this.guid();
        const layer = this.defaultLayers[type] ?? 'L-1';
        this.elements.set(g, { type, data: it, layer });
        return { elementId: { guid: g } };
      }),
    };
  }

  private handle(command: string, p: any): unknown {
    switch (command) {
      case 'GetStories':
        return {
          firstStory: -1,
          lastStory: this.stories.length - 2,
          actStory: 0,
          stories: this.stories,
        };
      case 'GetLibraries':
        return {
          libraries: [
            {
              name: 'Bibliothèque Archicad 28',
              type: 'LocalLibrary',
              available: !this.refuseZones,
            },
          ],
        };
      case 'GetProjectInfo':
        return { isUntitled: this.untitled, isTeamwork: false };
      case 'GetLayerOfElementDefaults':
        return {
          layersOfElementDefaults: p.elementTypes.map((t: string) =>
            this.defaultLayers[t]
              ? {
                  elementType: t,
                  layerId: { guid: this.defaultLayers[t] },
                  layerName: this.attributes.Layer!.find(
                    (l) => l.attributeId.guid === this.defaultLayers[t],
                  )?.name,
                }
              : { error: { code: 1, message: 'unsupported' } },
          ),
        };
      case 'SetLayerOfElementDefaults':
        return {
          executionResults: p.layersOfElementDefaults.map((it: any) => {
            const ok = it.elementType in this.defaultLayers;
            if (ok) this.defaultLayers[it.elementType] = it.layerId.guid;
            return { success: ok };
          }),
        };
      case 'SetStories':
        if (!this.untitled) throw new Error('refused: SetStories only in an untitled project');
        {
          const base = p.stories[0]?.index ?? this.stories[0]?.index ?? 0;
          this.stories = p.stories.map((s: any, i: number) => ({
            index: base + i,
            name: s.name,
            level: s.level,
            dispOnSections: s.dispOnSections,
          }));
        }
        return {};
      case 'GetAttributesByType':
        return { attributes: this.attributes[p.attributeType] ?? [] };
      case 'CreateLayers':
      case 'CreateZoneCategories': {
        const kind = command === 'CreateLayers' ? 'Layer' : 'ZoneCategory';
        const arr = p.layerDataArray ?? p.zoneCategoryDataArray;
        if (kind === 'ZoneCategory') this.categoryData.push(...arr);
        return {
          attributeIds: arr.map((a: any) => {
            if (!String(a.name).startsWith('MS - ')) throw new Error('refused: prefix');
            const list = this.attributes[kind]!;
            const attr = {
              attributeId: { guid: this.guid() },
              index: list.length + 1,
              name: a.name,
            };
            list.push(attr);
            return { attributeId: attr.attributeId };
          }),
        };
      }
      case 'GetElementsByType':
        return {
          elements: [...this.elements]
            .filter(([, e]) => e.type === p.elementType)
            .map(([g]) => ({ elementId: { guid: g } })),
        };
      case 'CreateZones':
        return this.create('Zone', p.zonesData, (z) =>
          this.refuseZones
            ? 'Failed to create new Zone'
            : !this.stories.some((s) => s.index === z.floorIndex)
              ? 'bad floor'
              : !z.allowOverlap && this.overlaps(z)
                ? 'Zones overlap'
                : null,
        );
      case 'CreateSlabs':
        return this.create('Slab', p.slabsData, () => null);
      case 'CreateWalls':
        return this.create('Wall', p.wallsData, (w) =>
          w.height > 0 && w.thickness > 0 ? null : 'bad wall',
        );
      case 'CreateRoofs':
        return this.create('Roof', p.roofsData, (r) =>
          r.polygonCoordinates.length >= 3 && r.angle > 0 ? null : 'bad roof',
        );
      case 'CreateStairs':
        return this.create('Stair', p.stairsData, () =>
          this.refuseStairs ? 'Failed to create new Stair' : null,
        );
      case 'GetAvailableLibraryParts':
        return this.refuseZones
          ? { libraryParts: [], skippedCount: 24 }
          : {
              libraryParts: [
                {
                  guid: '{4AE64969-2731-4802-86B3-08DD03364006}-{AE163506-E14C-46A2-9E09-B08E24712238}',
                  index: 1,
                  documentName: 'Marque de zone 28',
                  typeId: 'Room',
                },
              ],
              skippedCount: 0,
            };
      case 'CreateMorphs':
        return this.create('Morph', p.morphsData, (m) => {
          const n = m.body.vertices.length;
          return m.body.polygons.every((f: any) =>
            f.vertexIds.every((v: number) => v >= 0 && v < n),
          )
            ? null
            : 'vertex index';
        });
      case 'SetElementUserData':
        return {
          executionResults: p.elementUserData.map((it: any) => {
            if (this.hidden(it.elementId.guid))
              return {
                success: false,
                error: { code: -2130312912, message: 'the element is not editable' },
              };
            const d = this.userData.get(it.elementId.guid) ?? {};
            for (const kv of it.userData) d[kv.key] = kv.value;
            this.userData.set(it.elementId.guid, d);
            return { success: true };
          }),
        };
      case 'GetElementUserData':
        return {
          elementUserData: p.elements.map((it: any) => {
            const d = this.userData.get(it.elementId.guid) ?? {};
            return {
              userData: Object.entries(d)
                .filter(([k]) => !p.keys || p.keys.includes(k))
                .map(([key, value]) => ({ key, value })),
            };
          }),
        };
      case 'SetDetailsOfElements':
        return {
          executionResults: p.elementsWithDetails.map((it: any) => {
            const e = this.elements.get(it.elementId.guid);
            if (this.hidden(it.elementId.guid)) return { success: false };
            if (e) e.details = { ...e.details, ...it.details };
            return { success: !!e };
          }),
        };
      case 'DeleteElements':
        for (const it of p.elements)
          if (!this.userData.get(it.elementId.guid)?.['kubatur.projectId'])
            throw new Error('refused: element was not created by Kubatur');
        return {
          executionResults: p.elements.map((it: any) => {
            const ok = this.elements.delete(it.elementId.guid);
            this.userData.delete(it.elementId.guid);
            return { success: ok };
          }),
        };
      default:
        throw new Error(`fake: ${command} not implemented`);
    }
  }

  private hidden(guid: string) {
    const l = this.elements.get(guid)?.layer;
    return !!l && this.hiddenLayers.has(l);
  }

  /** Same floor and same first vertex = overlap (enough for tests). */
  private overlaps(z: any) {
    const p = z.geometry.polygonCoordinates[0];
    return [...this.elements.values()].some((e: any) => {
      if (e.type !== 'Zone' || !e.data) return false;
      const q = e.data.geometry.polygonCoordinates[0];
      return e.data.floorIndex === z.floorIndex && q.x === p.x && q.y === p.y;
    });
  }

  layerOf(guid: string) {
    return this.elements.get(guid)?.layer;
  }

  count(type: string) {
    return [...this.elements.values()].filter((e) => e.type === type).length;
  }
}
