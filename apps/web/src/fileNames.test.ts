import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Windows and macOS file systems ignore case: `./StoreyCut` then resolves to `storeyCut.ts`
 * instead of `StoreyCut.tsx` and the app fails to load there (white page), while Linux CI passes.
 * No two modules in one folder may differ only in case or extension.
 */
const roots = ['.', '../../../packages'].map((r) =>
  join(dirname(fileURLToPath(import.meta.url)), r),
);

function collisions(dir: string, out: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collisions(full, out);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
    const key = name.slice(0, -extname(name).length).toLowerCase();
    const prev = seen.get(key);
    if (prev) out.push(`${join(dir, prev)} ↔ ${name}`);
    else seen.set(key, name);
  }
  return out;
}

describe('file names', () => {
  it('no modules that differ only in case or extension (case-insensitive file systems)', () => {
    expect(roots.flatMap((r) => collisions(r))).toEqual([]);
  });
});
