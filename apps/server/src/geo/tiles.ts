import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Basemap } from './contract.js';
import { FRANCE_METRO_BBOX, inBBox } from './geometry.js';
import type { GeoHttp } from './http.js';

export const IGN_WMTS_URL = 'https://data.geopf.fr/wmts';
export const TILE_MIN_Z = 10;
export const TILE_MAX_Z = 19;

export const BASEMAPS: Record<Basemap, { layer: string; format: string; ext: string }> = {
  plan: { layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', ext: 'png' },
  ortho: { layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', ext: 'jpg' },
};

export function isBasemap(v: string): v is Basemap {
  return Object.hasOwn(BASEMAPS, v);
}

export interface TileAddress {
  basemap: Basemap;
  z: number;
  x: number;
  y: number;
}

/** Centre of a web-mercator tile in [lon, lat]. */
export function tileCenter(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** Returns an error message, or undefined if the tile address is valid. */
export function validateTile(z: number, x: number, y: number): string | undefined {
  if (!Number.isInteger(z) || z < TILE_MIN_Z || z > TILE_MAX_Z)
    return `z must be an integer ${TILE_MIN_Z}–${TILE_MAX_Z}`;
  const n = 2 ** z;
  if (!Number.isInteger(x) || x < 0 || x >= n) return `x must be an integer 0–${n - 1}`;
  if (!Number.isInteger(y) || y < 0 || y >= n) return `y must be an integer 0–${n - 1}`;
  return undefined;
}

/** IGN WMTS covers France; outside the box the proxy answers 404 without asking upstream. */
export function tileCovered(z: number, x: number, y: number): boolean {
  return inBBox(tileCenter(z, x, y), FRANCE_METRO_BBOX);
}

export function wmtsUrl({ basemap, z, x, y }: TileAddress, base = IGN_WMTS_URL): string {
  const { layer, format } = BASEMAPS[basemap];
  return (
    `${base}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal` +
    `&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${format}`
  );
}

/** IGN WMTS tile proxy with an on-disk byte cache (DATA_DIR/tiles/{basemap}/{z}/{x}/{y}.{ext}). */
export class TileProxy {
  constructor(
    private readonly http: GeoHttp,
    /** Cache root; undefined disables caching. */
    private readonly cacheDir: string | undefined,
    private readonly ttlMs: number,
    private readonly base = IGN_WMTS_URL,
    private readonly now: () => number = Date.now,
  ) {}

  private file(t: TileAddress): string | undefined {
    if (!this.cacheDir) return undefined;
    return join(
      this.cacheDir,
      t.basemap,
      String(t.z),
      String(t.x),
      `${t.y}.${BASEMAPS[t.basemap].ext}`,
    );
  }

  async tile(t: TileAddress): Promise<{ bytes: Uint8Array; contentType: string; cached: boolean }> {
    const contentType = BASEMAPS[t.basemap].format;
    const file = this.file(t);
    if (file) {
      try {
        const s = await stat(file);
        if (this.now() - s.mtimeMs <= this.ttlMs)
          return { bytes: new Uint8Array(await readFile(file)), contentType, cached: true };
      } catch {
        // not cached
      }
    }
    const { bytes } = await this.http.getBytes(wmtsUrl(t, this.base), {
      upstream: 'ign-wmts',
      accept: contentType,
    });
    if (file) {
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
      } catch {
        // cache is best effort
      }
    }
    return { bytes, contentType, cached: false };
  }
}
