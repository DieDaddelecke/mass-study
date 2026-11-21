/**
 * PDF export of composed sheets: jsPDF + svg2pdf.js (real vectors, selectable text, embedded
 * Inter, line widths in mm). Both libraries are loaded with `import()` so they stay out of the
 * main bundle.
 */
import type { Sheet } from './sheets';

export interface PdfFonts {
  /** Base64 TTF data. */
  regular: string;
  semibold: string;
}

/** Render sheets to a PDF (one page per sheet, page size = sheet size in mm). */
export async function renderPdf(
  sheets: readonly Sheet[],
  fonts: PdfFonts,
  title = '',
): Promise<ArrayBuffer> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const first = sheets[0];
  const size = (s: Sheet | undefined): [number, number] => [s?.widthMm ?? 420, s?.heightMm ?? 297];
  const [w0, h0] = size(first);
  const doc = new jsPDF({
    unit: 'mm',
    format: [w0, h0],
    orientation: w0 > h0 ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({ title, creator: 'Kubatur' });
  doc.addFileToVFS('Inter-Regular.ttf', fonts.regular);
  doc.addFileToVFS('Inter-SemiBold.ttf', fonts.semibold);
  // Drawings use font-family "'Kubatur Sans', Inter, …" – both map to the embedded Inter.
  for (const family of ['Inter', 'Kubatur Sans']) {
    doc.addFont('Inter-Regular.ttf', family, 'normal');
    doc.addFont('Inter-SemiBold.ttf', family, 'bold');
  }
  doc.setFont('Inter', 'normal');
  const parser = new DOMParser();
  for (const [i, s] of sheets.entries()) {
    const [w, h] = size(s);
    if (i > 0) doc.addPage([w, h], w > h ? 'landscape' : 'portrait');
    const el = parser.parseFromString(s.svg, 'image/svg+xml').documentElement;
    await svg2pdf(el, doc, { x: 0, y: 0, width: w, height: h });
  }
  return doc.output('arraybuffer');
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Load the OFL Inter TTFs (served as Vite assets, fetched on demand). */
export async function loadFonts(): Promise<PdfFonts> {
  const [{ default: r }, { default: b }] = await Promise.all([
    import('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url'),
    import('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?url'),
  ]);
  const [rb, bb] = await Promise.all([
    fetch(r).then((x) => x.arrayBuffer()),
    fetch(b).then((x) => x.arrayBuffer()),
  ]);
  return { regular: toBase64(rb), semibold: toBase64(bb) };
}
