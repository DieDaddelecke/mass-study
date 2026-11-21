import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyzeProject, type Schedule, type ScheduleRow } from '@kubatur/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { palaiseauDemo } from '../demo/palaiseau';
import i18n from '../i18n';
import { buildDossier } from './build';
import { renderPdf } from './pdf';
import {
  composeDossier,
  DEFAULT_OPTIONS,
  paginateRows,
  placeSvg,
  rowsPerPage,
  type DossierOptions,
} from './sheets';
import { buildPlanViews } from './views';

const require = createRequire(import.meta.url);

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  // jsdom has no SVG layout: svg2pdf measures text (text-anchor) with getBBox, so estimate it
  // with Inter's average advance (≈ 0.56 em). Browsers measure the real font.
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = function (
    this: SVGElement,
  ) {
    const size = parseFloat(this.getAttribute('font-size') ?? '16') || 16;
    return { x: 0, y: 0, width: (this.textContent ?? '').length * size * 0.56, height: size };
  };
});

const opts = (p: Partial<DossierOptions> = {}): DossierOptions => ({
  ...DEFAULT_OPTIONS,
  titleBlock: {
    office: 'Atelier Test',
    client: 'Ville de Palaiseau',
    index: 'B',
    date: '2026-11-21',
  },
  ...p,
});

describe('dossier sheets', () => {
  const project = palaiseauDemo();

  it('composes the standard A3 set with title blocks', () => {
    const sheets = buildDossier(project, project.activeVariantId, opts());
    expect(sheets.length).toBeGreaterThanOrEqual(6);
    expect(sheets[0]!.number).toBe('MS-001');
    for (const s of sheets) {
      expect(s.svg).toContain('width="420mm" height="297mm"');
      for (const v of ['Atelier Test', 'Ville de Palaiseau', 'Étude de capacité', s.number])
        expect(s.svg).toContain(v);
      expect(s.svg).toContain('Surfaces approximatives – sans garantie');
      expect(s.svg).toContain('Maître d’ouvrage');
    }
    expect(sheets.map((s) => s.title)).toContain('Plan masse');
  });

  it('places a view at its true paper size for a fixed scale', () => {
    const analysis = analyzeProject(project);
    const [v500] = buildPlanViews(project, analysis, {
      requests: [{ id: 'elevS', boxWidthMm: 1000, boxHeightMm: 1000, scale: 500 }],
      scheme: 'concours',
    });
    const [v250] = buildPlanViews(project, analysis, {
      requests: [{ id: 'elevS', boxWidthMm: 1000, boxHeightMm: 1000, scale: 250 }],
      scheme: 'concours',
    });
    expect(v500!.scale).toBe(500);
    // Geometry grows linearly with 1/scale (labels have a fixed paper size, so ≥ not =).
    expect(v250!.widthMm).toBeGreaterThan(1.8 * (v500!.widthMm - 16));
    // The SVG is 1 user unit = 1 mm: width attribute equals viewBox width → no extra scaling.
    const w = /width="([\d.]+)mm"/.exec(v500!.svg)![1]!;
    const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(v500!.svg)![1]!;
    expect(Number(w)).toBeCloseTo(Number(vb), 2);
    expect(Number(w)).toBeCloseTo(v500!.widthMm, 1);
    const g = placeSvg(v500!.svg, 30, 40, v500!.widthMm, v500!.heightMm);
    expect(g.startsWith('<g transform="translate(30 40)')).toBe(true);
    expect(g).not.toContain(' scale(');
  });

  it('auto scale picks a standard scale fitting the box', () => {
    const analysis = analyzeProject(project);
    const [v] = buildPlanViews(project, analysis, {
      requests: [{ id: 'site', boxWidthMm: 370, boxHeightMm: 190, scale: 'auto' }],
      scheme: 'permis',
    });
    expect([200, 250, 500, 1000, 2000]).toContain(v!.scale);
    if (v!.scale < 2000) expect(v!.widthMm).toBeLessThanOrEqual(370);
  });

  it('paginates long tables and repeats the header', () => {
    const per = rowsPerPage('A3');
    expect(paginateRows(Array.from({ length: per * 2 + 1 }), per)).toHaveLength(3);
    const rows: ScheduleRow[] = Array.from({ length: per * 2 + 5 }, (_, i) => ({
      kind: 'row',
      depth: 0,
      cells: { name: `Ligne ${i}`, v: i },
    }));
    const long: Schedule = {
      id: 'surfaces',
      title: { key: 'tables:tab.surfaces' },
      columns: [
        { key: 'name', label: { key: 'tables:col.indicator' }, format: 'text' },
        { key: 'v', label: { key: 'tables:col.actual' }, format: 'dec2' },
      ],
      rows,
    };
    const analysis = analyzeProject(project);
    const sheets = composeDossier(
      {
        project,
        analysis,
        variantName: 'V1',
        schedules: [long],
        t: (k, p) => i18n.t(`dossier:${k}`, p ?? {}),
        formatNumber: (v) => String(v),
      },
      opts({
        sheets: {
          ...DEFAULT_OPTIONS.sheets,
          cover: false,
          site: false,
          elevations: false,
          sections: false,
          axo: false,
        },
      }),
    );
    expect(sheets).toHaveLength(3);
    expect(sheets[1]!.title).toContain('(suite)');
    for (const s of sheets) expect(s.svg).toContain('Indicateur');
    expect(sheets[2]!.svg).toContain(`Ligne ${per * 2 + 4}`);
  });
});

describe('dossier PDF', () => {
  it('renders the Palaiseau dossier to a vector PDF', async () => {
    const project = palaiseauDemo();
    const sheets = buildDossier(project, project.activeVariantId, opts());
    const font = (f: string) =>
      readFileSync(require.resolve(`@expo-google-fonts/inter/${f}`)).toString('base64');
    const pdf = await renderPdf(
      sheets,
      {
        regular: font('400Regular/Inter_400Regular.ttf'),
        semibold: font('600SemiBold/Inter_600SemiBold.ttf'),
      },
      project.name,
    );
    const buf = Buffer.from(pdf);
    // DOSSIER_PDF=/path/out.pdf pnpm test … writes the sample for manual inspection
    if (process.env.DOSSIER_PDF) writeFileSync(process.env.DOSSIER_PDF, buf);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeLessThan(10 * 1024 * 1024);
    const pages = buf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBe(sheets.length);
  }, 60_000);
});
