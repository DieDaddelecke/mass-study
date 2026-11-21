import {
  createProject,
  defaultSettings,
  rect,
  type Mass,
  type Project,
  type Typology,
} from '../src/index.js';

export function mass(typology: Typology, over: Partial<Mass> = {}): Mass {
  return {
    id: over.id ?? 'm1',
    name: 'BK1',
    typology,
    position: [0, 0],
    rotation: 0,
    storeys: {
      basement: { count: 0, height: 3 },
      ground: { height: 3.5 },
      upper: { count: 4, height: 3 },
      parapet: 0,
      slabThickness: 0.3,
    },
    usage: 'wohnen',
    access: 'auto',
    ...over,
  };
}

/** Reference case §17: site 50 × 40 m, bar 40 × 12 m, EG 3.50 + 4 OG × 3.00, no parapet, no basement. */
export function referenceProject(profile: 'DE' | 'FR' = 'DE'): Project {
  const p = createProject({
    name: 'Referenz',
    localBoundary: rect(-25, -20, 25, 20),
    lonLat: [7.0, 51.0],
    profile,
  });
  p.settings = defaultSettings(profile);
  p.variants[0]!.masses.push(
    mass(
      { kind: 'zeile', length: 40, depth: 12, sections: 1, sectionOffset: 0 },
      { position: [-20, 0] },
    ),
  );
  return p;
}
