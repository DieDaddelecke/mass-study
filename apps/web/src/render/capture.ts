import { useShellStore } from '../shell/shellStore';
import { useUiStore } from '../store/uiStore';
import type { Capture } from './renderStore';
import { useRenderStore } from './renderStore';

/** Longest side sent to the provider (px). */
export const MAX_SIDE = 1536;

/**
 * Aspect ratios the image models return (Gemini / OpenRouter list). The capture is centre-cropped
 * to the closest one so the result has exactly the framing of the view and can be laid over it.
 */
export const RATIOS: readonly [string, number][] = [
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
];

export function closestRatio(aspect: number): [string, number] {
  let best = RATIOS[0]!;
  for (const r of RATIOS)
    if (Math.abs(Math.log(r[1] / aspect)) < Math.abs(Math.log(best[1] / aspect))) best = r;
  return best;
}

/** Source rectangle: the canvas, centre-cropped to the closest supported ratio. */
export function cropRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const [, r] = closestRatio(w / h);
  if (w / h > r) {
    const cw = Math.round(h * r);
    return { x: Math.round((w - cw) / 2), y: 0, w: cw, h };
  }
  const ch = Math.round(w / r);
  return { x: 0, y: Math.round((h - ch) / 2), w, h: ch };
}

/** Output size: scaled so the longest side is at most MAX_SIDE. */
export function outputSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(64, Math.round(w * s)), h: Math.max(64, Math.round(h * s)) };
}

/**
 * Edge strength of an RGBA image (Sobel on luminance), 0–255 per pixel. The massing model has
 * dark outlines and flat shaded faces, so the strong edges are the building edges.
 */
export function edgeMagnitude(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    lum[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        lum[i - w + 1]! +
        2 * lum[i + 1]! +
        lum[i + w + 1]! -
        lum[i - w - 1]! -
        2 * lum[i - 1]! -
        lum[i + w - 1]!;
      const gy =
        lum[i + w - 1]! +
        2 * lum[i + w]! +
        lum[i + w + 1]! -
        lum[i - w - 1]! -
        2 * lum[i - w]! -
        lum[i - w + 1]!;
      out[i] = Math.min(255, Math.hypot(gx, gy));
    }
  return out;
}

/** Edge threshold: weak shading gradients are dropped, outlines and face changes stay. */
const EDGE_MIN = 40;

/** Line drawing for the model (black lines on white) and an overlay to check the result. */
function lineImages(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const mag = edgeMagnitude(src.data, w, h);
  const guide = new ImageData(w, h);
  const overlay = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const on = mag[i]! >= EDGE_MIN;
    const v = on ? Math.max(0, 255 - mag[i]! * 2) : 255;
    guide.data.set([v, v, v, 255], i * 4);
    // red lines on transparent, drawn over the result
    if (on) overlay.data.set([230, 30, 60, Math.min(255, mag[i]! * 2)], i * 4);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.putImageData(guide, 0, 0);
  const g = c.toDataURL('image/png');
  x.clearRect(0, 0, w, h);
  x.putImageData(overlay, 0, 0);
  return { guide: g, overlay: c.toDataURL('image/png') };
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
    const lines = lineImages(ctx, o.w, o.h);
    return {
      image: c.toDataURL('image/jpeg', 0.92),
      width: o.w,
      height: o.h,
      ratio: closestRatio(o.w / o.h)[0],
      ...lines,
    };
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
