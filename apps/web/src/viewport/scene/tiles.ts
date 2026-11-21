import { localToLonLat, lonLatToLocal, type LocalFrame, type Vec2 } from '@kubatur/core';

/** Fractional web-mercator tile coordinates of a lon/lat at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * n,
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  ];
}

/** Lon/lat of the north-west corner of tile (x, y) (fractional allowed). */
export function tileToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

export interface TileRange {
  z: number;
  x0: number;
  y0: number;
  /** inclusive */
  x1: number;
  y1: number;
}

/** Zoom used for a context extent of the given radius (m). */
export function zoomForRadius(radius: number): number {
  return radius <= 200 ? 18 : 17;
}

/** Tiles covering a local bbox (min/max corners, metres). */
export function tileRangeForLocalBox(
  frame: LocalFrame,
  min: Vec2,
  max: Vec2,
  z: number,
): TileRange {
  const corners: Vec2[] = [min, [max[0], min[1]], max, [min[0], max[1]]];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of corners) {
    const [lon, lat] = localToLonLat(frame, c);
    const [tx, ty] = lonLatToTile(lon, lat, z);
    x0 = Math.min(x0, Math.floor(tx));
    x1 = Math.max(x1, Math.floor(tx));
    y0 = Math.min(y0, Math.floor(ty));
    y1 = Math.max(y1, Math.floor(ty));
  }
  return { z, x0, y0, x1, y1 };
}

/**
 * Local coordinates of the mosaic corners in the order NW, NE, SE, SW (texture uv (0,1), (1,1),
 * (1,0), (0,0)). Handles the rotation / scale of the projected CRS relative to web mercator.
 */
export function mosaicCorners(frame: LocalFrame, r: TileRange): [Vec2, Vec2, Vec2, Vec2] {
  const at = (x: number, y: number) => lonLatToLocal(frame, tileToLonLat(x, y, r.z));
  return [at(r.x0, r.y0), at(r.x1 + 1, r.y0), at(r.x1 + 1, r.y1 + 1), at(r.x0, r.y1 + 1)];
}
