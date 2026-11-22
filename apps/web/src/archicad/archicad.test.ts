import {
  createMass,
  createProject,
  DEFAULT_STAIR_RULES,
  layoutStairs,
  massLayout,
  massToSolids,
  rect,
  type Mass,
  type Project,
  type Vec2,
} from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from './bridgeClient';
import { nativeStair } from './native';
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
  it('plans native elements by default: dwelling zones, SDP zones, walls, slabs, stairs', () => {
    const pl = plan();
    const { masses, p } = project();
    const solids = masses.flatMap((m) => massToSolids(m, p.settings));
    expect(pl.counts.zones).toBeGreaterThan(0);
    expect(pl.counts.sdpZones).toBe(solids.length);
    expect(pl.counts.walls).toBeGreaterThan(0);
    expect(pl.counts.slabs).toBeGreaterThan(0);
    expect(pl.counts.stairs).toBeGreaterThan(0);
    expect(pl.counts.morphs).toBe(0);
    const unit = pl.items.find((i) => i.role === 'unit')!;
    expect(unit.zone!.numberStr).toMatch(/^A-/);
    expect(unit.zone!.name).toMatch(/^T\d/);
    expect(unit.zone!.allowOverlap).toBe(false);
    const sdp = pl.items.find((i) => i.role === 'sdp')!;
    expect(sdp.zone!.numberStr).toMatch(/^MS-A-.*-SDP$/);
    expect(sdp.zone!.allowOverlap).toBe(true);
    expect(sdp.zone!.height).toBeGreaterThan(2);
    expect(pl.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining(['MS - Logement', 'MS - Bureaux', 'MS - SDP']),
    );
    // keys are unique (they identify the elements in Archicad)
    expect(new Set(pl.items.map((i) => i.key)).size).toBe(pl.items.length);
  });

  it('never invents stories: levels map onto existing ones with an offset', () => {
    const pl = plan();
    for (const s of pl.storeys) expect(stories.some((x) => x.index === s.storyIndex)).toBe(true);
    for (const i of pl.items.filter((x) => x.kind === 'zone')) {
      const st = stories.find((s) => s.index === i.zone!.floorIndex)!;
      expect(st.level + i.zone!.bottomOffset!).toBeCloseTo(i.z0, 6);
    }
    for (const i of pl.items.filter((x) => x.kind === 'wall')) {
      const st = stories.find((s) => s.index === i.wall!.floorIndex)!;
      expect(st.level + i.wall!.zCoordinate).toBeCloseTo(i.z0, 6);
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

  it('one slab per floor level with absolute levels, stair openings and a roof slab', () => {
    const only = { zones: false, sdpZones: false, walls: false, roofs: false, stairs: false };
    const pl = plan(only);
    expect(pl.items.every((i) => i.kind === 'slab' && i.slab!.level === i.z0)).toBe(true);
    const { masses, p } = project();
    const a = massToSolids(masses[0]!, p.settings);
    const slabsA = pl.items.filter((i) => i.massName === 'A');
    // every floor level plus the roof
    expect(new Set(slabsA.map((i) => i.z0)).size).toBe(a.length + 1);
    // the stairs cut openings into the floors they arrive at
    expect(slabsA.some((i) => (i.slab!.holes ?? []).length > 0)).toBe(true);
    expect(slabsA.some((i) => i.slab!.id!.includes('TOIT'))).toBe(true);
  });

  it('façade walls run on the centre line inside the footprint, up to the slab above', () => {
    const pl = plan({ zones: false, sdpZones: false, slabs: false, stairs: false });
    const { masses, p } = project();
    const s0 = massToSolids(masses[0]!, p.settings).find((s) => s.storeyIndex === 0)!;
    const walls = pl.items.filter(
      (i) => i.kind === 'wall' && i.massName === 'A' && i.key.includes('|f'),
    );
    const ground = walls.filter((w) => w.z0 === s0.z0);
    expect(ground).toHaveLength(s0.footprint.outer.length);
    const slab = masses[0]!.storeys.slabThickness;
    for (const w of ground) {
      expect(w.wall!.thickness).toBe(DEFAULT_OPTIONS.facadeWall);
      expect(w.wall!.height).toBeCloseTo(s0.z1 - s0.z0 - slab, 6);
      expect(w.wall!.referenceLineLocation).toBe('Center');
    }
    // interior walls (cores, party walls) exist as well and are not on the façade
    expect(pl.items.some((i) => i.kind === 'wall' && i.key.includes('|i'))).toBe(true);
  });

  it('pitched roofs become single-plane roofs that rise away from their pivot line', () => {
    const { p, masses } = project();
    const m: Mass = { ...masses[0]!, roof: { kind: 'gable', pitch: 35, ridge: 'length' } };
    const pl = buildPlan({
      project: p,
      masses: [m],
      stories,
      options: {
        ...DEFAULT_OPTIONS,
        zones: false,
        sdpZones: false,
        walls: false,
        slabs: false,
        stairs: false,
      },
      usageLabel: label,
    });
    const roofs = pl.items.filter((i) => i.kind === 'roof');
    expect(roofs).toHaveLength(2);
    for (const r of roofs) {
      expect(r.roof!.angle).toBeCloseTo((35 * Math.PI) / 180, 6);
      const { begCoordinate: b, endCoordinate: e } = r.roof!.pivotLine;
      const ring = r.roof!.polygonCoordinates;
      const c = {
        x: ring.reduce((s, q) => s + q.x, 0) / ring.length,
        y: ring.reduce((s, q) => s + q.y, 0) / ring.length,
      };
      // the roof rises on the left of the pivot line: the face lies left of it
      expect((e.x - b.x) * (c.y - b.y) - (e.y - b.y) * (c.x - b.x)).toBeGreaterThan(0);
    }
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

  it('a core stair becomes an Archicad U-stair whose flights lie inside the U', () => {
    const { p, masses } = project();
    const m = masses[0]!;
    const solids = massToSolids(m, p.settings);
    const list = [...layoutStairs([massLayout(m, solids, p.settings)], p.settings).values()].flat();
    expect(list.length).toBeGreaterThan(0);
    for (const st of list) {
      const n = nativeStair(st)!;
      expect(n.points).toHaveLength(4);
      const [p0, p1, p2] = n.points as [Vec2, Vec2, Vec2];
      // flight 1 lies on the side the baseline position says
      const f = st.flights[0]!.polygon.outer;
      const c: Vec2 = [
        f.reduce((s, q) => s + q[0], 0) / f.length,
        f.reduce((s, q) => s + q[1], 0) / f.length,
      ];
      const cross = (p1[0] - p0[0]) * (c[1] - p0[1]) - (p1[1] - p0[1]) * (c[0] - p0[0]);
      expect(n.baseline).toBe(cross > 0 ? 'Right' : 'Left');
      // the landing edge spans both flights and the gap
      const across = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      expect(across).toBeCloseTo(2 * st.flights[0]!.width + DEFAULT_STAIR_RULES.gap, 6);
      // flight 1 is long enough for its treads
      const run = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      expect(run).toBeGreaterThanOrEqual((st.flights[0]!.risers - 1) * st.going - 1e-6);
      expect(n.height).toBeCloseTo(st.z1 - st.z0, 6);
    }
  });

  it('plans one native stair per core and storey, with morphs as fallback', () => {
    const pl = plan();
    const st = pl.items.filter((i) => i.kind === 'stair');
    expect(st).toHaveLength(pl.counts.stairs);
    for (const i of st) {
      expect(i.stair!.baseLineEdges.map((e) => e.segmentType)).toEqual([
        'Flight',
        'Landing',
        'Flight',
      ]);
      expect(i.stair!.zCoordinate).toBe(i.z0);
      const story = stories.find((s) => s.index === i.stair!.floorIndex)!;
      expect(story.level).toBeLessThanOrEqual(i.z0 + 0.05);
      // two flights and one landing as stand-in morphs
      expect(i.fallback).toHaveLength(3);
      for (const m of i.fallback!) expect(closed(m.body)).toBe(true);
    }
    expect(plan({ stairs: false }).counts.stairs).toBe(0);
  });
});

describe('executePlan', () => {
  it('creates, tags and layers elements; replace removes only our own', async () => {
    const ac = new FakeArchicad();
    const foreign = ac.addForeign('Zone');
    const pl = plan({ morphs: true });
    const r1 = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r1.errors).toEqual([]);
    const expected: Record<string, number> = { ...pl.counts };
    delete expected.storeys;
    expect(r1.created).toEqual(expected);
    expect(ac.attributes.Layer!.some((l) => l.name === 'MS - Massenstudie')).toBe(true);
    expect(ac.attributes.ZoneCategory!.map((c) => c.name)).toEqual(
      expect.arrayContaining(['MS - Logement', 'MS - Bureaux', 'MS - SDP']),
    );
    // zones and stairs land on our layer although the tools' default layer is hidden …
    const ms = ac.attributes.Layer!.find((l) => l.name === 'MS - Massenstudie')!;
    const on = (type: string) =>
      [...ac.elements].filter(([, e]) => e.type === type && e.layer === ms.attributeId.guid);
    expect(on('Zone')).toHaveLength(pl.counts.zones + pl.counts.sdpZones);
    expect(on('Stair')).toHaveLength(pl.counts.stairs);
    // … and the defaults are restored afterwards
    expect(ac.defaultLayers).toEqual({ Zone: 'L-Z', Stair: 'L-Z', Roof: 'L-Z' });

    const own = Object.values(expected).reduce((a, b) => a + b, 0);
    const snap = await readSnapshot(ac, 19723, 'p1');
    expect(snap.ownElements).toBe(own);

    const r2 = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'replace' });
    expect(r2.deleted).toBe(own);
    expect(ac.count('Zone')).toBe(pl.counts.zones + pl.counts.sdpZones + 1);
    expect(ac.elements.has(foreign)).toBe(true);
    // categories are not duplicated on a second run
    expect(ac.attributes.ZoneCategory!.filter((c) => c.name === 'MS - Logement')).toHaveLength(1);

    expect(await removeOwnElements(ac, 19723, 'p1')).toBe(own);
    expect(ac.elements.size).toBe(1);
  });

  it('gives new zone categories a loaded zone stamp', async () => {
    const ac = new FakeArchicad();
    const snap = await readSnapshot(ac, 19723, 'p1');
    expect(snap.zoneStamps).toBe(1);
    expect(snap.zoneStamp).toEqual({
      name: 'Marque de zone 28',
      mainGuid: '{4AE64969-2731-4802-86B3-08DD03364006}',
      revGuid: '{AE163506-E14C-46A2-9E09-B08E24712238}',
    });
    await executePlan(ac, 19723, plan(), {
      projectId: 'p1',
      mode: 'create',
      zoneStamp: snap.zoneStamp!,
    });
    expect(ac.categoryData.length).toBeGreaterThan(0);
    expect(ac.categoryData.every((d) => d.stampMainGuid === snap.zoneStamp!.mainGuid)).toBe(true);
    ac.refuseZones = true;
    expect((await readSnapshot(ac, 19723, 'p1')).zoneStamps).toBe(0);
  });

  it("gives dwelling zones the project's own category of their type (T1 … T5)", async () => {
    const ac = new FakeArchicad();
    ac.attributes.ZoneCategory!.push(
      ...['T1', 'T2', 'T3', 'T4', 'T5'].map((name, i) => ({
        attributeId: { guid: `C-${name}` },
        index: 10 + i,
        name,
      })),
    );
    await executePlan(ac, 19723, plan(), { projectId: 'p1', mode: 'create' });
    const zones = [...ac.elements.values()].filter((e) => e.type === 'Zone');
    const data = zones.map(
      (e) => e.data as { name: string; categoryAttributeId?: { guid: string } },
    );
    const units = data.filter((d) => /^T\d$/.test(d.name));
    expect(units.length).toBeGreaterThan(0);
    for (const d of units) expect(d.categoryAttributeId!.guid).toBe(`C-${d.name}`);
    // SDP zones keep the Kubatur category
    const ms = ac.attributes.ZoneCategory!.find((c) => c.name === 'MS - SDP')!;
    expect(
      data
        .filter((d) => d.name.startsWith('SDP'))
        .every((d) => d.categoryAttributeId!.guid === ms.attributeId.guid),
    ).toBe(true);
  });

  it('replaces SDP zones by morphs when Archicad refuses every zone', async () => {
    const ac = new FakeArchicad();
    ac.refuseZones = true;
    const pl = plan();
    const r = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r.zoneFallback).toBe(true);
    expect(r.created.zones).toBe(0);
    expect(r.created.morphs).toBe(pl.counts.sdpZones);
    expect(r.created.walls).toBe(pl.counts.walls);
    expect(r.errors).toEqual([]);
  });

  it('does not duplicate morphs when morphs were planned anyway', async () => {
    const ac = new FakeArchicad();
    ac.refuseZones = true;
    const pl = plan({ morphs: true });
    const r = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r.zoneFallback).toBe(true);
    expect(r.created.morphs).toBe(pl.counts.morphs);
  });

  it('builds a refused stair from morphs', async () => {
    const ac = new FakeArchicad();
    ac.refuseStairs = true;
    const pl = plan();
    const r = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r.errors).toEqual([]);
    expect(r.stairFallbacks).toBe(pl.counts.stairs);
    expect(r.created.stairs).toBe(pl.counts.stairs);
    expect(ac.count('Stair')).toBe(0);
    expect(ac.count('Morph')).toBe(pl.counts.stairs * 3);
  });
});

describe('Archicad preparation', () => {
  it('reports elements it could not tag instead of failing silently', async () => {
    const ac = new FakeArchicad();
    const orig = ac.call.bind(ac);
    // an older Tapir without the layer-defaults commands
    ac.call = (async (port: number, command: string, p?: unknown) => {
      if (command.endsWith('LayerOfElementDefaults')) throw new Error('unknown command');
      return orig(port, command, p);
    }) as typeof ac.call;
    const pl = plan();
    const r = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r.created.zones).toBe(pl.counts.zones);
    // zones and stairs stay on the hidden default layer
    const hidden = pl.counts.zones + pl.counts.sdpZones + pl.counts.stairs;
    expect(r.errors.filter((e) => e.message.startsWith(TAG_FAILED))).toHaveLength(hidden);
  });

  it('warns when several levels share one Archicad story and replaces refused SDP zones by morphs', async () => {
    const ac = new FakeArchicad([{ index: 0, name: 'RDC', level: 0 }]);
    const { p, masses } = project();
    const pl = buildPlan({
      project: p,
      masses: masses.slice(0, 1),
      stories: ac.stories,
      options: {
        ...DEFAULT_OPTIONS,
        zones: false,
        walls: false,
        slabs: false,
        roofs: false,
        stairs: false,
      },
      usageLabel: label,
    });
    expect(pl.warnings.map((w) => w.code)).toContain('sharedStory');
    const r = await executePlan(ac, 19723, pl, { projectId: 'p1', mode: 'create' });
    expect(r.created.sdpZones).toBe(1);
    expect(r.standIns).toBe(pl.counts.sdpZones - 1);
    expect(r.created.morphs).toBe(pl.counts.sdpZones - 1);
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
