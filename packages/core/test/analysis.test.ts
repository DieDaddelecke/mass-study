import { describe, expect, it } from 'vitest';
import {
  analyzeMasses,
  analyzeProject,
  defaultSettings,
  judge,
  requiredCores,
  resolveAccess,
  suitability,
} from '../src/index.js';
import { mass, referenceProject } from './helpers.js';

const s = defaultSettings('DE');

describe('typologies and access', () => {
  it('picks access types by depth', () => {
    expect(
      resolveAccess(
        mass({ kind: 'zeile', length: 40, depth: 9, sections: 1, sectionOffset: 0 }),
        s,
      ),
    ).toBe('laubengang');
    expect(
      resolveAccess(
        mass({ kind: 'zeile', length: 40, depth: 14, sections: 1, sectionOffset: 0 }),
        s,
      ),
    ).toBe('dreispaenner');
    expect(
      resolveAccess(
        mass({ kind: 'zeile', length: 40, depth: 17, sections: 1, sectionOffset: 0 }),
        s,
      ),
    ).toBe('mittelflur');
    expect(resolveAccess(mass({ kind: 'solitaer', length: 20, depth: 20 }), s)).toBe('punkthaus');
    expect(
      resolveAccess(
        mass({ kind: 'reihe', count: 5, unitWidth: 6, depth: 10, alternatingOffset: 0 }),
        s,
      ),
    ).toBe('reihenhaus');
    expect(
      resolveAccess(mass({ kind: 'solitaer', length: 20, depth: 20 }, { usage: 'buero' }), s),
    ).toBe('buero');
    expect(
      resolveAccess(mass({ kind: 'solitaer', length: 20, depth: 20 }, { access: 'laubengang' }), s),
    ).toBe('laubengang');
  });

  it('suitability traffic lights', () => {
    const list = suitability(
      { kind: 'zeile', length: 40, depth: 12, sections: 1, sectionOffset: 0 },
      'wohnen',
      s,
    );
    const st = Object.fromEntries(list.map((x) => [x.type, x.status]));
    expect(st).toMatchObject({
      zweispaenner: 'ok',
      dreispaenner: 'ok',
      laubengang: 'ok',
      mittelflur: 'error',
      punkthaus: 'error',
    });
    const office = suitability(
      { kind: 'zeile', length: 40, depth: 15, sections: 1, sectionOffset: 0 },
      'buero',
      s,
    );
    expect(office.find((x) => x.type === 'kombibuero')!.status).toBe('ok');
    expect(suitability({ kind: 'solitaer', length: 10, depth: 10 }, 'gewerbe', s)).toEqual([]);
  });

  it('cores from escape distance and section length', () => {
    const long = mass({ kind: 'zeile', length: 100, depth: 16, sections: 1, sectionOffset: 0 });
    expect(requiredCores(long, 'mittelflur', s)).toBe(2);
    expect(requiredCores(long, 'zweispaenner', s)).toBe(5);
    expect(requiredCores(mass({ kind: 'solitaer', length: 20, depth: 20 }), 'punkthaus', s)).toBe(
      1,
    );
    expect(requiredCores(long, 'reihenhaus', s)).toBe(0);
  });
});

describe('variant analysis', () => {
  it('row houses: one dwelling per unit', () => {
    const m = mass({ kind: 'reihe', count: 6, unitWidth: 6, depth: 10, alternatingOffset: 0 });
    m.storeys.upper.count = 1;
    const r = analyzeMasses([m], s);
    expect(r.dwellings).toBe(6);
    expect(r.masses[0]!.cores).toBe(0);
  });

  it('mixed use: workplaces, parking and garage', () => {
    const m = mass({ kind: 'solitaer', length: 30, depth: 15 }, { usage: 'buero' });
    m.storeys.basement = { count: 1, height: 3 };
    const r = analyzeMasses([m], s);
    expect(r.workplaces).toBeGreaterThan(0);
    expect(r.parking.capacity).toBe(Math.floor((450 * 0.9) / 25));
    expect(r.areasBelow.bgf).toBeCloseTo(450);
    expect(r.usageNuf.buero).toBeGreaterThan(0);
  });

  it('overlapping masses produce a warning and an overlap-free GR', () => {
    const p = referenceProject('DE');
    p.variants[0]!.masses.push(
      mass({ kind: 'solitaer', length: 10, depth: 10 }, { id: 'm2', position: [0, 0] }),
    );
    const a = analyzeProject(p);
    expect(a.warnings.some((w) => w.code === 'massOverlap')).toBe(true);
    // 480 + 100 − overlap (10 × 10 fully inside the bar's 12 m depth)
    expect(a.de.gr).toBeCloseTo(480, 4);
  });

  it('masses outside the site and exceeded targets are reported', () => {
    const p = referenceProject('DE');
    p.variants[0]!.masses[0]!.position = [-10, 0];
    p.constraints = { grz: 0.2, gfz: 1.5, maxHeight: 16 };
    p.context = [
      {
        id: 'c1',
        footprint: {
          outer: [
            [100, 100],
            [110, 100],
            [110, 110],
          ],
        },
        height: 9,
        source: 'osm',
        heightEstimated: true,
      },
    ];
    const a = analyzeProject(p);
    const codes = a.warnings.map((w) => w.code);
    expect(codes).toContain('outsideSite');
    expect(codes).toContain('constraintExceeded');
    expect(codes).toContain('estimatedContextHeights');
    expect(a.constraints.find((c) => c.key === 'gfz')!.status).toBe('ok');
    expect(a.constraints.find((c) => c.key === 'totalHeight')!.status).toBe('warning');
  });

  it('judge thresholds', () => {
    expect(judge(1)).toBe('none');
    expect(judge(0.5, 1)).toBe('ok');
    expect(judge(0.97, 1)).toBe('warning');
    expect(judge(1.01, 1)).toBe('error');
  });

  it('building classes', () => {
    const one = mass({ kind: 'solitaer', length: 12, depth: 10 });
    one.storeys.upper.count = 1;
    one.storeys.ground.height = 3;
    const p = referenceProject('DE');
    p.variants[0]!.masses = [one];
    p.settings.unitMix = [
      { id: 'h', label: 'Haus', share: 1, areaMin: 150, areaTarget: 180, areaMax: 200 },
    ];
    expect(analyzeProject(p).de.buildingClass).toBe(1);
    const tall = mass({ kind: 'solitaer', length: 24, depth: 24 });
    tall.storeys.upper.count = 9;
    p.variants[0]!.masses = [tall];
    const de = analyzeProject(p).de;
    expect(de.buildingClass).toBe(5);
    expect(de.elevatorRequired).toBe(true);
    expect(de.highRise).toBe(true);
  });
});
