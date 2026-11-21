import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/index.js';
import { referenceProject } from './helpers.js';

describe('reference case (SPEC §17)', () => {
  const a = analyzeProject(referenceProject('DE'));

  it('site and footprint', () => {
    expect(a.de.siteArea).toBeCloseTo(2000, 6);
    expect(a.de.gr).toBeCloseTo(480, 6);
    expect(a.de.grz).toBeCloseTo(0.24, 6);
  });

  it('floor areas and volume', () => {
    expect(a.result.areas.bgf).toBeCloseTo(2400, 6);
    expect(a.de.gf).toBeCloseTo(2400, 6);
    expect(a.de.gfz).toBeCloseTo(1.2, 6);
    expect(a.result.areas.bri).toBeCloseTo(7440, 6);
  });

  it('heights and building class', () => {
    expect(a.de.totalHeight).toBeCloseTo(15.5, 6);
    expect(a.de.mboHeight).toBeCloseTo(12.5, 6);
    expect(a.de.maxFullStoreys).toBe(5);
    expect(a.de.buildingClass).toBe(4);
    expect(a.de.elevatorRequired).toBe(false);
    expect(a.de.highRise).toBe(false);
  });

  it('is inside the site without warnings about placement', () => {
    expect(a.warnings.filter((w) => w.code === 'outsideSite' || w.code === 'massOverlap')).toEqual(
      [],
    );
  });

  it('DIN 277 chain is consistent', () => {
    const f = a.result.areas;
    expect(f.kgf + f.nrf).toBeCloseTo(f.bgf, 6);
    expect(f.nuf + f.vf + f.tf).toBeCloseTo(f.nrf, 6);
    // 5 storeys × (perimeter 104 m × 0.40 + 5 % × 480)
    expect(f.kgf).toBeCloseTo(5 * (104 * 0.4 + 24), 6);
    expect(a.result.masses[0]!.access).toBe('zweispaenner');
    expect(f.vf).toBeCloseTo(f.nrf * 0.08, 6);
  });

  it('FR profile on the same model', () => {
    const fr = analyzeProject(referenceProject('FR')).fr;
    expect(fr.ces).toBeCloseTo(0.24, 6);
    expect(fr.hauteurEgout).toBeCloseTo(15.5, 6);
    expect(fr.niveaux).toBe(5);
    expect(fr.formula).toBe('R+4');
    // SDP = Σ(BGF − exterior walls − TF) − 10 % residential
    const per = 480 - 41.6;
    const nrf = 480 - (41.6 + 24);
    const sdpStorey = per - nrf * 0.02;
    expect(fr.surfaceDePlancher).toBeCloseTo(5 * sdpStorey * 0.9, 6);
  });
});
