import type { Project, Vec2 } from '@kubatur/core';
import { ringBBox } from '@kubatur/core';
import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from 'three';
import type { Basemap as BasemapKind } from '../../api/contract';
import { mosaicCorners, tileRangeForLocalBox, zoomForRadius, type TileRange } from './tiles';

const MAX_RADIUS = 500;
const cache = new Map<string, Promise<HTMLImageElement | null>>();

function loadTile(
  kind: BasemapKind,
  z: number,
  x: number,
  y: number,
): Promise<HTMLImageElement | null> {
  const key = `${kind}/${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/api/tiles/${key}`;
    });
    cache.set(key, p);
  }
  return p;
}

/** Local bbox of everything shown around the site (at least ±150 m around the site centre). */
export function contextExtent(project: Project): { min: Vec2; max: Vec2; radius: number } {
  const site = project.site.boundary.outer;
  const sb = site.length ? ringBBox(site) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const cx = (sb.minX + sb.maxX) / 2;
  const cy = (sb.minY + sb.maxY) / 2;
  let minX = cx - 150,
    minY = cy - 150,
    maxX = cx + 150,
    maxY = cy + 150;
  const add = (p: readonly Vec2[]) => {
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  };
  add(site);
  for (const b of project.context) add(b.footprint.outer);
  const s = project.surroundings;
  if (s) {
    for (const r of s.roads) add(r.centerline);
    for (const g of s.green) add(g.footprint.outer);
    for (const w of s.water) add(w.footprint.outer);
    for (const p of s.parcels) add(p.polygon.outer);
    add(s.trees.map((t) => t.position));
  }
  minX = Math.max(minX, cx - MAX_RADIUS);
  minY = Math.max(minY, cy - MAX_RADIUS);
  maxX = Math.min(maxX, cx + MAX_RADIUS);
  maxY = Math.min(maxY, cy + MAX_RADIUS);
  const radius = Math.max(maxX - minX, maxY - minY) / 2;
  return { min: [minX, minY], max: [maxX, maxY], radius };
}

/** Quad geometry through the 4 mosaic corners (NW, NE, SE, SW) with matching uv. */
export function mosaicQuad(corners: readonly Vec2[], z: number): BufferGeometry {
  const [nw, ne, se, sw] = corners as [Vec2, Vec2, Vec2, Vec2];
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute(
      [sw[0], sw[1], z, se[0], se[1], z, ne[0], ne[1], z, nw[0], nw[1], z],
      3,
    ),
  );
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

async function stitch(kind: BasemapKind, r: TileRange): Promise<HTMLCanvasElement | null> {
  const w = r.x1 - r.x0 + 1;
  const h = r.y1 - r.y0 + 1;
  const jobs: Promise<[number, number, HTMLImageElement | null]>[] = [];
  for (let x = r.x0; x <= r.x1; x++)
    for (let y = r.y0; y <= r.y1; y++)
      jobs.push(loadTile(kind, r.z, x, y).then((img) => [x, y, img]));
  const tiles = await Promise.all(jobs);
  if (!tiles.some((t) => t[2])) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w * 256;
  canvas.height = h * 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (const [x, y, img] of tiles)
    if (img) ctx.drawImage(img, (x - r.x0) * 256, (y - r.y0) * 256, 256, 256);
  return canvas;
}

/** IGN plan / ortho tiles stitched into one ground texture (drawn only if tiles load). */
export function Basemap({ project, kind, z }: { project: Project; kind: BasemapKind; z: number }) {
  const range = useMemo(() => {
    const e = contextExtent(project);
    return tileRangeForLocalBox(project.geo, e.min, e.max, zoomForRadius(e.radius));
  }, [project]);
  const geometry = useMemo(
    () => mosaicQuad(mosaicCorners(project.geo, range), z),
    [project.geo, range, z],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [tex, setTex] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    let alive = true;
    let t: CanvasTexture | null = null;
    stitch(kind, range)
      .then((canvas) => {
        if (!alive || !canvas) return;
        t = new CanvasTexture(canvas);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
      t?.dispose();
      setTex(null);
    };
  }, [kind, range]);
  if (!tex) return null;
  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={-5}>
      <meshBasicMaterial map={tex} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
