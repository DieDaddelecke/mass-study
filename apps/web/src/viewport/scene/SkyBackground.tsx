import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, Color, SRGBColorSpace, type Texture } from 'three';

/** Screen-space vertical gradient as scene background (soft sky, no visible horizon line). */
export function SkyBackground({ top, horizon }: { top: string; horizon: string }) {
  const scene = useThree((s) => s.scene);
  const texture = useMemo(() => skyTexture(top, horizon), [top, horizon]);
  useEffect(() => {
    const prev = scene.background;
    scene.background = texture ?? new Color(horizon);
    return () => {
      scene.background = prev;
      texture?.dispose();
    };
  }, [scene, texture, horizon]);
  return null;
}

function skyTexture(top: string, horizon: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.75, horizon);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
