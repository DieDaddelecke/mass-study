import { createMass, createProject, rect, type Mass, type Project } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from './bridgeClient';
import { FakeArchicad } from './fakeArchicad';
import {
  buildPlan,
  DEFAULT_OPTIONS,
  extrudeBody,
  matchStory,
  placePoint,
  type PlanOptions,
} from './plan';
import { executePlan, readSnapshot, removeOwnElements } from './transfer';

const label = (u: string) => ({ wohnen: 'Logement', buero: 'Bureaux' })[u] ?? u;

function project(): { p: Project; masses: Mass[] } {
  const p = createProject({ name: 'T', localBoundary: rect(-30, -30, 30, 30), profile: 'FR' });
  const a = createMass('solitaer', { name: 'A' });
  const b = createMass('solitaer', { name: 'B', position: [20, 0], usage: 'buero' });
  return { p, masses: [a, b] };
}

const stories = new FakeArchicad().stories;

function plan(opts: Partial<PlanOptions> = {}) {
  const { p, masses } = project();
  return buildPlan({
    project: p,
    masses,
    stories,
    options: { ...DEFAULT_OPTIONS, ...opts },
    usageLabel: label,
  });
}

describe('geometry', () => {
  it('places points with rotation and offset', () => {
    expect(placePoint([1, 0], { offsetX: 10, offsetY: 5, rotationDeg: 90 })).toEqual({
      x: 10,
      y: 6,
    });
  });

  it('extrudes a closed body with holes', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hole = [
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 3 },
    ];
    const b = extrudeBody(outer, [hole], 3);
    expect(b.vertices).toHaveLength(16);
    // top + bottom + 4 outer walls + 4 hole walls
    expect(b.polygons).toHaveLength(10);
    expect(b.polygons[0]!.holes).toHaveLength(1);
    // every edge is shared by exactly two faces (closed solid); hole loops count as face edges
    const edges = new Map<string, number>();
    for (const f of b.polygons)
      for (const loop of [f.vertexIds, ...(f.holes ?? []).map((h) => h.vertexIds)])
        loop.forEach((v, i) => {
          const w = loop[(i + 1) % loop.length]!;
          const k = v < w ? `${v}-${w}` : `${w}-${v}`;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        });
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    // top face counter-clockwise seen from above
    const top = b.polygons[0]!.vertexIds.map((i) => b.vertices[i]!);
    const area = top.reduce((s, p, i) => {
      const q = top[(i + 1) % top.length]!;
      return s + p.x * q.y - q.x * p.y;
    }, 0);
    expect(area).toBeGreaterThan(0);
  });
});

describe('story matching', () => {
  it('uses the highest story at or below the level', () => {
    expect(matchStory(0, stories)!.story.name).toBe('RDC');
    expect(matchStory(3.5, stories)!).toMatchObject({ exact: true });
    expect(matchStory(4.2, stories)!).toMatchObject({ exact: false, story: { name: 'R+1' } });
    expect(matchStory(-10, stories)).toBeNull();
  });
});

describe('buildPlan', () => {
  it('creates one zone and one morph per storey solid', () => {
    const pl = plan();
    expect(pl.counts.zones).toBeGreaterThan(0);
    expect(pl.counts.zones).toBe(pl.counts.morphs);
    expect(pl.counts.slabs).toBe(0);
    const z = pl.items.find((i) => i.kind === 'zone')!;
    expect(z.zone!.numberStr).toMatch(/^MS-A-/);
    expect(z.zone!.allowOverlap).toBe(false);
    expect(z.zone!.height).toBeGreaterThan(2);
    expect(pl.usages).toEqual(['wohnen', 'buero']);
  });

  it('never invents stories: levels map onto existing ones with an offset', () => {
    const pl = plan();
    for (const s of pl.storeys) expect(stories.some((x) => x.index === s.storyIndex)).toBe(true);
    const z = pl.items.filter((i) => i.kind === 'zone');
    for (const i of z) {
      const st = stories.find((s) => s.index === i.zone!.floorIndex)!;
      expect(st.level + i.zone!.bottomOffset!).toBeCloseTo(i.z0, 6);
    }
  });

  it('warns about unavailable libraries and missing stories', () => {
    const { p, masses } = project();
    const pl = buildPlan({
      project: p,
      masses,
      stories: [{ index: 0, name: 'RDC', level: 0 }],
      libraries: [{ name: 'Bibliothèque Archicad 27', type: 'LocalLibrary', available: false }],
      options: DEFAULT_OPTIONS,
      usageLabel: label,
    });
    expect(pl.warnings.map((w) => w.code)).toContain('librariesMissing');
    expect(pl.warnings.map((w) => w.code)).toContain('levelWithoutStory');
  });

  it('slabs carry absolute levels', () => {
    const pl = plan({ slabs: true, zones: false, morphs: false });
    expect(pl.items.every((i) => i.kind === 'slab' && i.slab!.level === i.z0)).toBe(true);
  });
});

describe('executePlan', () => {
  it('creates, tags and layers elements; replace removes only our own', async () => {
    const ac = new FakeArchicad();
    const foreign = ac.addForeign('Zone');
    const pl = plan();
    const r1 = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'create',
      usageLabel: label,
    });
    expect(r1.errors).toEqual([]);
    expect(r1.created.zones).toBe(pl.counts.zones);
    expect(r1.created.morphs).toBe(pl.counts.morphs);
    expect(ac.attributes.Layer!.some((l) => l.name === 'MS - Massenstudie')).toBe(true);
    expect(ac.attributes.ZoneCategory!.map((c) => c.name)).toEqual(
      expect.arrayContaining(['MS - Logement', 'MS - Bureaux']),
    );
    const zones = [...ac.elements].filter(([, e]) => e.type === 'Zone' && e.details);
    expect(zones).toHaveLength(pl.counts.zones);

    const snap = await readSnapshot(ac, 19723, 'p1');
    expect(snap.ownElements).toBe(pl.counts.zones + pl.counts.morphs);

    const r2 = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'replace',
      usageLabel: label,
    });
    expect(r2.deleted).toBe(pl.counts.zones + pl.counts.morphs);
    expect(ac.count('Zone')).toBe(pl.counts.zones + 1);
    expect(ac.elements.has(foreign)).toBe(true);
    // categories are not duplicated on a second run
    expect(ac.attributes.ZoneCategory!.filter((c) => c.name === 'MS - Logement')).toHaveLength(1);

    expect(await removeOwnElements(ac, 19723, 'p1')).toBe(pl.counts.zones + pl.counts.morphs);
    expect(ac.elements.size).toBe(1);
  });

  it('falls back to morphs when Archicad refuses every zone', async () => {
    const ac = new FakeArchicad();
    ac.refuseZones = true;
    const pl = plan({ morphs: false });
    const r = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'create',
      usageLabel: label,
    });
    expect(r.zoneFallback).toBe(true);
    expect(r.created.zones).toBe(0);
    expect(r.created.morphs).toBe(pl.counts.zones);
    expect(r.errors).toEqual([]);
  });

  it('does not duplicate morphs when morphs were planned anyway', async () => {
    const ac = new FakeArchicad();
    ac.refuseZones = true;
    const pl = plan({ morphs: true });
    const r = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'create',
      usageLabel: label,
    });
    expect(r.zoneFallback).toBe(true);
    expect(r.created.morphs).toBe(pl.counts.morphs);
  });
});

describe('BridgeClient', () => {
  it('sends the token and unwraps results', async () => {
    const calls: [string, RequestInit][] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ ok: true, result: { stories: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new BridgeClient('http://127.0.0.1:19780', 'ABCD-EFGH', fetchImpl);
    await expect(c.call(19723, 'GetStories')).resolves.toEqual({ stories: [] });
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer ABCD-EFGH');
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      port: 19723,
      command: 'GetStories',
      parameters: {},
    });
  });

  it('maps errors to kinds', async () => {
    const mk = (status: number) =>
      (async () =>
        new Response(JSON.stringify({ ok: false, error: { message: 'x' } }), {
          status,
        })) as unknown as typeof fetch;
    await expect(new BridgeClient(undefined, '', mk(401)).health()).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    await expect(new BridgeClient(undefined, '', mk(403)).health()).rejects.toMatchObject({
      kind: 'refused',
    });
    await expect(new BridgeClient(undefined, '', mk(502)).health()).rejects.toMatchObject({
      kind: 'archicad',
    });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(new BridgeClient(undefined, '', down).health()).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });
});
