import type { Project } from '@kubatur/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBlob, safeFileName } from '../exports/download';
import { actions } from '../store/projectStore';
import { useShellStore } from '../shell/shellStore';
import { Dialog, Row } from '../shell/ui';
import { buildDossier } from './build';
import './dossier.css';
import { loadFonts, renderPdf } from './pdf';
import {
  DEFAULT_OPTIONS,
  PAPER,
  SHEET_KINDS,
  type DossierOptions,
  type PaperFormat,
  type ScaleChoice,
} from './sheets';
import { STANDARD_SCALES } from './views';

const STORAGE_KEY = 'kubatur.dossier';
type Stored = Omit<DossierOptions, 'titleBlock'> & { coverImage: boolean };

function loadStored(): Stored {
  const base: Stored = { ...DEFAULT_OPTIONS, coverImage: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Stored>) };
  } catch {
    /* storage unavailable */
  }
  return base;
}

function saveStored(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Snapshot of the 3D canvas (needs preserveDrawingBuffer, see Viewport3D). */
function capture3d(): { href: string; width: number; height: number } | undefined {
  const c = document.querySelector<HTMLCanvasElement>('.vp-canvas canvas');
  if (!c || !c.width || !c.height) return undefined;
  try {
    return { href: c.toDataURL('image/jpeg', 0.92), width: c.width, height: c.height };
  } catch {
    return undefined;
  }
}

/** Read a logo file; SVG is rasterised to PNG (svg2pdf embeds raster images reliably). */
async function readLogo(file: File): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  if (!file.type.includes('svg')) return url;
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = 800;
  const h = Math.max(1, Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')?.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/** "Créer le dossier" (SPEC §12): options, page-by-page preview, PDF export. */
export function DossierDialog({ project }: { project: Project }) {
  const { t } = useTranslation('dossier');
  const shell = useShellStore.getState();
  const close = () => shell.setDialog(null);
  const [stored, setStored] = useState<Stored>(loadStored);
  const [variantId, setVariantId] = useState(project.activeVariantId);
  const [tb, setTb] = useState({
    office: project.info.office ?? '',
    client: project.info.client ?? '',
    index: project.info.revision || 'A',
    date: project.info.date || new Date().toISOString().slice(0, 10),
  });
  const [logo, setLogo] = useState<string | undefined>(project.info.logo);
  const [cover] = useState(capture3d);
  const [pageIdx, setPageIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const update = (p: Partial<Stored>) => {
    const next = { ...stored, ...p };
    setStored(next);
    saveStored(next);
  };
  const opts: DossierOptions = useMemo(() => ({ ...stored, titleBlock: tb }), [stored, tb]);
  const coverImage = stored.coverImage && variantId === project.activeVariantId ? cover : undefined;
  const sheets = useMemo(
    () => buildDossier(project, variantId, opts, { logo, coverImage }),
    [project, variantId, opts, logo, coverImage],
  );
  const page = sheets[Math.min(pageIdx, sheets.length - 1)];

  const run = async () => {
    setBusy(true);
    try {
      actions.updateInfo((p) => {
        p.info.office = tb.office;
        p.info.client = tb.client;
        p.info.revision = tb.index;
        p.info.date = tb.date;
        p.info.logo = logo;
      });
      const pdf = await renderPdf(sheets, await loadFonts(), project.name);
      downloadBlob(
        new Blob([pdf], { type: 'application/pdf' }),
        `${safeFileName(project.name)} – ${t('fileSuffix')}.pdf`,
      );
      shell.setInfo(t('dialog.done', { pages: sheets.length }));
      close();
    } catch (e) {
      console.error('PDF export failed', e);
      shell.setError(t('dialog.failed'));
    } finally {
      setBusy(false);
    }
  };

  const scaleSelect = (k: keyof DossierOptions['scales']) => (
    <Row key={k} label={t(`dialog.scaleOf.${k}`)}>
      <select
        aria-label={t(`dialog.scaleOf.${k}`)}
        value={String(stored.scales[k])}
        onChange={(e) => {
          const v: ScaleChoice = e.target.value === 'auto' ? 'auto' : Number(e.target.value);
          update({ scales: { ...stored.scales, [k]: v } });
        }}
      >
        <option value="auto">{t('dialog.auto')}</option>
        {STANDARD_SCALES.map((s) => (
          <option key={s} value={s}>
            1:{s}
          </option>
        ))}
      </select>
    </Row>
  );

  return (
    <Dialog
      open
      wide
      title={t('title')}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t('common:actions.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || sheets.length === 0}
            onClick={() => void run()}
          >
            {busy ? t('dialog.exporting') : t('dialog.export')}
          </button>
        </>
      }
    >
      <div className="dossier-grid">
        <div className="dossier-options">
          <p className="muted">{t('intro')}</p>
          <Row label={t('dialog.variant')}>
            <select
              aria-label={t('dialog.variant')}
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              {project.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('dialog.format')}>
            <select
              aria-label={t('dialog.format')}
              value={stored.format}
              onChange={(e) => update({ format: e.target.value as PaperFormat })}
            >
              {(Object.keys(PAPER) as PaperFormat[]).map((f) => (
                <option key={f} value={f}>
                  {t(`dialog.formats.${f}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('dialog.scheme')}>
            <select
              aria-label={t('dialog.scheme')}
              value={stored.scheme}
              onChange={(e) => update({ scheme: e.target.value as DossierOptions['scheme'] })}
            >
              <option value="concours">{t('dialog.schemes.concours')}</option>
              <option value="permis">{t('dialog.schemes.permis')}</option>
            </select>
          </Row>
          <h4 className="dossier-h">{t('dialog.sheets')}</h4>
          <ul className="list">
            {SHEET_KINDS.map((k) => (
              <li key={k}>
                <label className="list-row">
                  <span className="list-text">{t(`sheet.${k}`)}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    aria-label={t(`sheet.${k}`)}
                    checked={stored.sheets[k]}
                    onChange={(e) =>
                      update({ sheets: { ...stored.sheets, [k]: e.target.checked } })
                    }
                  />
                </label>
              </li>
            ))}
            <li>
              <label className="list-row">
                <span className="list-text">{t('dialog.coverImage')}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  aria-label={t('dialog.coverImage')}
                  disabled={!cover}
                  checked={stored.coverImage && !!cover}
                  onChange={(e) => update({ coverImage: e.target.checked })}
                />
              </label>
            </li>
          </ul>
          <Row label={t('dialog.elevationsPerSheet')}>
            <select
              aria-label={t('dialog.elevationsPerSheet')}
              value={stored.elevationsPerSheet}
              onChange={(e) => update({ elevationsPerSheet: Number(e.target.value) as 2 | 4 })}
            >
              <option value={4}>{t('dialog.fourPerSheet')}</option>
              <option value={2}>{t('dialog.twoPerSheet')}</option>
            </select>
          </Row>
          <h4 className="dossier-h">{t('dialog.scales')}</h4>
          {(['site', 'elevations', 'sections', 'axo'] as const).map(scaleSelect)}
          <h4 className="dossier-h">{t('dialog.titleBlock')}</h4>
          {(['office', 'client', 'index', 'date'] as const).map((k) => (
            <Row key={k} label={t(`dialog.${k}`)}>
              <input
                aria-label={t(`dialog.${k}`)}
                type={k === 'date' ? 'date' : 'text'}
                value={tb[k]}
                onChange={(e) => setTb({ ...tb, [k]: e.target.value })}
              />
            </Row>
          ))}
          <Row label={t('dialog.logo')}>
            <span className="dossier-logo">
              {logo && <img src={logo} alt="" />}
              <label className="btn btn-sm">
                {t('dialog.logoUpload')}
                <input
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readLogo(f).then(setLogo);
                  }}
                />
              </label>
              {logo && (
                <button className="btn btn-sm" onClick={() => setLogo(undefined)}>
                  {t('dialog.logoRemove')}
                </button>
              )}
            </span>
          </Row>
        </div>
        <div className="dossier-preview">
          {page ? (
            <>
              <div className="dossier-pager">
                <span>{t('dialog.preview')}</span>
                <span className="dossier-pages">
                  {sheets.map((s, i) => (
                    <button
                      key={s.number}
                      className={`dossier-dot${s === page ? ' active' : ''}`}
                      title={`${s.number} – ${s.title}`}
                      aria-label={t('dialog.page', { n: i + 1, count: sheets.length })}
                      onClick={() => setPageIdx(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </span>
              </div>
              <div
                className="dossier-page"
                data-testid="dossier-page"
                dangerouslySetInnerHTML={{ __html: page.svg }}
              />
              <div className="muted dossier-caption">
                {page.number} · {page.title} · {page.scaleLabel}
              </div>
            </>
          ) : (
            <p className="muted">{t('dialog.empty')}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
