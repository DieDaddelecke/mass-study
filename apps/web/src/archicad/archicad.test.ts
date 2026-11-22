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
  prismBody,
  proposeStories,
  type PlanOptions,
} from './plan';
import { applyStories, executePlan, readSnapshot, removeOwnElements, TAG_FAILED } from './transfer';

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
    const pl = plan({ slabs: true, zones: false, morphs: false, stairs: false });
    expect(pl.items.every((i) => i.kind === 'slab' && i.slab!.level === i.z0)).toBe(true);
  });
});

describe('stairs', () => {
  const closed = (b: ReturnType<typeof prismBody>) => {
    const edges = new Map<string, number>();
    for (const f of b.polygons)
      f.vertexIds.forEach((v, i) => {
        const w = f.vertexIds[(i + 1) % f.vertexIds.length]!;
        const k = `${v}>${w}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      });
    // closed and consistently oriented: every directed edge once, its reverse once
    return [...edges.keys()].every((k) => {
      const [a, c] = k.split('>');
      return edges.get(k) === 1 && edges.get(`${c}>${a}`) === 1;
    });
  };

  it('prismBody: closed, outward faces for any ring orientation', () => {
    const ring = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ];
    for (const r of [ring, [...ring].reverse()]) {
      const b = prismBody(r, { x: 0, y: 1.2, z: 0 });
      expect(closed(b)).toBe(true);
      // "top" face (ring + e) has its normal along +y
      const [p, q, s] = b.polygons[0]!.vertexIds.map((i) => b.vertices[i]!);
      const ny = (q!.z - p!.z) * (s!.x - p!.x) - (q!.x - p!.x) * (s!.z - p!.z);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('plans one stair per core and storey (flights + landing as morphs on the right story)', () => {
    const pl = plan();
    const st = pl.items.filter((i) => i.kind === 'stair');
    expect(pl.counts.stairs).toBeGreaterThan(0);
    // two flights and one landing per stair
    expect(st).toHaveLength(pl.counts.stairs * 3);
    for (const i of st) {
      expect(closed(i.morph!.body)).toBe(true);
      expect(i.morph!.basePoint.z).toBe(i.z0);
      const story = stories.find((s) => s.index === i.morph!.floorIndex)!;
      expect(story.level).toBeLessThanOrEqual(i.z0 + 0.05);
      const zs = i.morph!.body.vertices.map((v) => v.z);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(-0.3);
      expect(Math.max(...zs)).toBeLessThanOrEqual(4);
    }
    expect(plan({ stairs: false }).counts.stairs).toBe(0);
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
    // zones land on our layer although the zone tool's default layer is hidden …
    const ms = ac.attributes.Layer!.find((l) => l.name === 'MS - Massenstudie')!;
    const zones = [...ac.elements].filter(
      ([, e]) => e.type === 'Zone' && e.layer === ms.attributeId.guid,
    );
    expect(zones).toHaveLength(pl.counts.zones);
    // … and the default is restored afterwards
    expect(ac.zoneDefaultLayer).toBe('L-Z');

    const stairParts = pl.items.filter((i) => i.kind === 'stair').length;
    expect(r1.created.stairs).toBe(pl.counts.stairs);
    const own = pl.counts.zones + pl.counts.morphs + stairParts;
    const snap = await readSnapshot(ac, 19723, 'p1');
    expect(snap.ownElements).toBe(own);

    const r2 = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'replace',
      usageLabel: label,
    });
    expect(r2.deleted).toBe(own);
    expect(ac.count('Zone')).toBe(pl.counts.zones + 1);
    expect(ac.elements.has(foreign)).toBe(true);
    // categories are not duplicated on a second run
    expect(ac.attributes.ZoneCategory!.filter((c) => c.name === 'MS - Logement')).toHaveLength(1);

    expect(await removeOwnElements(ac, 19723, 'p1')).toBe(own);
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

describe('Archicad preparation', () => {
  it('reports zones it could not tag instead of failing silently', async () => {
    const ac = new FakeArchicad();
    const orig = ac.call.bind(ac);
    // an older Tapir without the layer-defaults commands
    ac.call = (async (port: number, command: string, p?: unknown) => {
      if (command.endsWith('LayerOfElementDefaults')) throw new Error('unknown command');
      return orig(port, command, p);
    }) as typeof ac.call;
    const pl = plan({ morphs: false });
    const r = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'create',
      usageLabel: label,
    });
    expect(r.created.zones).toBe(pl.counts.zones);
    expect(r.errors).toHaveLength(pl.counts.zones);
    expect(r.errors.every((e) => e.message.startsWith(TAG_FAILED))).toBe(true);
  });

  it('warns when several levels share one Archicad story and replaces refused zones by morphs', async () => {
    const ac = new FakeArchicad([{ index: 0, name: 'RDC', level: 0 }]);
    const { p, masses } = project();
    const pl = buildPlan({
      project: p,
      masses: masses.slice(0, 1),
      stories: ac.stories,
      options: { ...DEFAULT_OPTIONS, morphs: false },
      usageLabel: label,
    });
    expect(pl.warnings.map((w) => w.code)).toContain('sharedStory');
    const r = await executePlan(ac, 19723, pl, {
      projectId: 'p1',
      mode: 'create',
      usageLabel: label,
    });
    expect(r.created.zones).toBe(1);
    expect(r.standIns).toBe(pl.counts.zones - 1);
    expect(r.created.morphs).toBe(pl.counts.zones - 1);
    expect(r.zoneFallback).toBe(false);
  });

  it('proposes stories that match every app level and keeps basements and surplus stories', () => {
    const current = [
      { index: -1, name: 'SS', level: -3 },
      { index: 0, name: 'RDC', level: 0 },
      { index: 1, name: 'Niv 1', level: 3.77 },
      { index: 2, name: 'Niv 2', level: 6.54 },
      { index: 3, name: 'Toit', level: 9.31 },
    ];
    const levels = [
      { elevation: 0, label: 'RDC' },
      { elevation: 3.5, label: 'R+1' },
      { elevation: 6.5, label: 'R+2' },
    ];
    const pr = proposeStories(levels, current);
    expect(pr.matches).toBe(false);
    expect(pr.stories.map((s) => [s.name, s.level])).toEqual([
      ['SS', -3],
      ['RDC', 0],
      ['R+1', 3.5],
      ['R+2', 6.5],
      ['Toit', 9.5],
    ]);
    expect(pr.stories[0]!.index).toBe(-1);
    expect(pr.changes).toHaveLength(3);
    // nothing to do when the stories already match
    const again = proposeStories(
      levels,
      pr.stories.map((s, i) => ({ ...s, index: i - 1 })),
    );
    expect(again.matches).toBe(true);
    expect(again.changes).toEqual([]);
    // more app levels than stories: new stories on top, surplus raised above
    const more = proposeStories(
      [...levels, { elevation: 9.5, label: 'R+3' }, { elevation: 12.5, label: 'R+4' }],
      current,
    );
    expect(more.stories.map((s) => s.level)).toEqual([-3, 0, 3.5, 6.5, 9.5, 12.5]);
    expect(more.stories.at(-1)!.name).toBe('R+4');
    // one label on two levels (masses with different floor heights): unique names
    const twice = proposeStories([...levels, { elevation: 7, label: 'R+2' }], current);
    expect(twice.stories.map((s) => s.name)).toEqual(
      expect.arrayContaining(['R+2 (6.50)', 'R+2 (7.00)']),
    );
  });

  it('applies stories so every level gets its own story', async () => {
    const ac = new FakeArchicad([
      { index: 0, name: 'RDC', level: 0 },
      { index: 1, name: 'Niv 1', level: 3.77 },
    ]);
    const { p, masses } = project();
    const opts = { ...DEFAULT_OPTIONS };
    const before = buildPlan({
      project: p,
      masses,
      stories: ac.stories,
      options: opts,
      usageLabel: label,
    });
    const pr = proposeStories(before.storeys, ac.stories);
    await applyStories(ac, 19723, pr.stories);
    const after = buildPlan({
      project: p,
      masses,
      stories: ac.stories,
      options: opts,
      usageLabel: label,
    });
    expect(after.storeys.every((m) => m.exact)).toBe(true);
    expect(after.warnings.map((w) => w.code)).not.toContain('sharedStory');
    ac.untitled = false;
    await expect(applyStories(ac, 19723, pr.stories)).rejects.toThrow(/untitled/);
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
