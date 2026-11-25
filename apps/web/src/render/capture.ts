import { useShellStore } from '../shell/shellStore';
import { useUiStore } from '../store/uiStore';
import type { Capture } from './renderStore';
import { useRenderStore } from './renderStore';

/** Longest side sent to the provider (px). */
export const MAX_SIDE = 1536;
/** Providers accept aspect ratios between 1:2.5 and 2.5:1. */
export const MAX_ASPECT = 2.5;

/** Source rectangle: the canvas, centre-cropped to the accepted aspect range. */
export function cropRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const a = w / h;
  if (a > MAX_ASPECT) {
    const cw = Math.round(h * MAX_ASPECT);
    return { x: Math.round((w - cw) / 2), y: 0, w: cw, h };
  }
  if (a < 1 / MAX_ASPECT) {
    const ch = Math.round(w * MAX_ASPECT);
    return { x: 0, y: Math.round((h - ch) / 2), w, h: ch };
  }
  return { x: 0, y: 0, w, h };
}

/** Output size: scaled so the longest side is at most MAX_SIDE, multiples of 8. */
export function outputSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const r8 = (v: number) => Math.max(64, Math.round((v * s) / 8) * 8);
  return { w: r8(w), h: r8(h) };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Copy of the 3D canvas (needs preserveDrawingBuffer, see Viewport3D). */
export function captureCanvas(): Capture | null {
  const src = document.querySelector<HTMLCanvasElement>('.vp-canvas canvas');
  if (!src || !src.width || !src.height) return null;
  const r = cropRect(src.width, src.height);
  const o = outputSize(r.w, r.h);
  const c = document.createElement('canvas');
  c.width = o.w;
  c.height = o.h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, o.w, o.h);
  try {
    return { image: c.toDataURL('image/jpeg', 0.92), width: o.w, height: o.h };
  } catch {
    return null;
  }
}

/**
 * "Rendu IA": hides selection and hover highlights, waits for the redraw, captures the view and
 * opens the dialog. Nothing is sent until the user presses "Générer".
 */
export async function openRenderDialog(): Promise<void> {
  const ui = useUiStore.getState();
  const selection = ui.selection;
  if (selection.length) ui.setSelection([]);
  ui.setHover(null);
  for (let i = 0; i < 3; i++) await nextFrame();
  const cap = captureCanvas();
  if (selection.length) useUiStore.getState().setSelection(selection);
  useRenderStore.getState().setCapture(cap);
  useShellStore.getState().setDialog('render');
}
