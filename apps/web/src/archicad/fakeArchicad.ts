/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed test double */
import type { ArchicadCaller } from './bridgeClient';
import type { TapirStory } from './tapir';

/**
 * In-memory stand-in for bridge + Archicad, mirroring tools/archicad-bridge/mock_archicad.py
 * (same commands, same shapes, same "kubatur.projectId" guard on deletes). For tests only.
 */
export class FakeArchicad implements ArchicadCaller {
  elements = new Map<string, { type: string; data?: unknown; details?: Record<string, unknown> }>();
  userData = new Map<string, Record<string, string>>();
  attributes: Record<string, { attributeId: { guid: string }; index: number; name: string }[]> = {
    Layer: [{ attributeId: { guid: 'L-1' }, index: 1, name: 'Calque Archicad' }],
    ZoneCategory: [{ attributeId: { guid: 'C-1' }, index: 1, name: 'Zone' }],
  };
  log: string[] = [];
  refuseZones = false;
  private n = 0;

  constructor(
    public stories: TapirStory[] = [
      { index: -1, name: 'R-1', level: -3 },
      { index: 0, name: 'RDC', level: 0 },
      { index: 1, name: 'R+1', level: 3.5 },
      { index: 2, name: 'R+2', level: 6.5 },
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
        this.elements.set(g, { type, data: it });
        return { elementId: { guid: g } };
      }),
    };
  }

  private handle(command: string, p: any): unknown {
    switch (command) {
      case 'GetStories':
        return { firstStory: -1, lastStory: 2, actStory: 0, stories: this.stories };
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
        return { isUntitled: true, isTeamwork: false };
      case 'GetAttributesByType':
        return { attributes: this.attributes[p.attributeType] ?? [] };
      case 'CreateLayers':
      case 'CreateZoneCategories': {
        const kind = command === 'CreateLayers' ? 'Layer' : 'ZoneCategory';
        const arr = p.layerDataArray ?? p.zoneCategoryDataArray;
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
            : this.stories.some((s) => s.index === z.floorIndex)
              ? null
              : 'bad floor',
        );
      case 'CreateSlabs':
        return this.create('Slab', p.slabsData, () => null);
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

  count(type: string) {
    return [...this.elements.values()].filter((e) => e.type === type).length;
  }
}
