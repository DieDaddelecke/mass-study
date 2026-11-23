import { describe, expect, it } from 'vitest';
import { grainFrame, woodMaterial, updateWood, WOOD_SPECIES } from './modelMaterials';

describe('grainFrame', () => {
  it('runs the grain along the longest edge of the largest footprint', () => {
    const bar = {
      outer: [
        [0, 0],
        [0, 40],
        [-12, 40],
        [-12, 0],
      ] as [number, number][],
    };
    const small = {
      outer: [
        [100, 100],
        [130, 100],
        [130, 101],
        [100, 101],
      ] as [number, number][],
    };
    const f = grainFrame([small, bar]);
    expect(Math.abs(f.dir[0])).toBeCloseTo(0);
    expect(Math.abs(f.dir[1])).toBeCloseTo(1);
    expect(f.origin[0]).toBeCloseTo(-6);
    expect(f.origin[1]).toBeCloseTo(20);
  });
});

describe('woodMaterial', () => {
  it('shares one shader program and updates its uniforms in place', () => {
    const b = { dir: [1, 0] as const, origin: [0, 0] as const, species: WOOD_SPECIES[0]!, seed: 3 };
    const a = woodMaterial(b);
    const c = woodMaterial({ ...b, seed: 10 });
    expect(a.customProgramCacheKey()).toBe(c.customProgramCacheKey());
    updateWood(a, { ...b, dir: [0, 1] });
    expect(a.userData.wood.uGrainDir.value.y).toBe(1);
  });
});
