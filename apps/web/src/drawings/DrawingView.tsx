import { massLayouts, resolveUnitRules } from '@kubatur/core';
import {
  chooseScale,
  renderSvg,
  STANDARD_SCALES,
  typicalStorey,
  type ColorScheme,
} from '@kubatur/drawing';
import { Building2, Download, Maximize, Minus, Plus, Scissors } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBlob, safeFileName } from '../exports/download';
import { IconButton } from '../shell/ui';
import { useShellStore } from '../shell/shellStore';
import { useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { buildDrawing, type DrawingViewId } from './buildDrawing';
import { FloorPlanLegend } from './FloorPlanLegend';
import './drawings.css';

/** Usable area of an A3 landscape sheet minus title block, for the automatic scale (mm). */
const AUTO_BOX: [number, number] = [400, 260];
const PX_PER_MM = 96 / 25.4;

interface ViewState {
  x: number;
  y: number;
  k: number;
}

/**
 * 2D views (site plan, elevations, sections, axonometry) rendered from `@kubatur/drawing` as a
 * white paper sheet with pan (drag) and zoom (wheel).
 */
export function DrawingView({ view }: { view: DrawingViewId }) {
  const { t } = useTranslation('drawing');
  const project = useProjectStore((s) => s.project);
  const analysis = useAnalysis();
  const leftOpen = useShellStore((s) => s.leftOpen);
  const inspectorOpen = useShellStore((s) => s.inspectorOpen);
  const [scheme, setScheme] = useState<ColorScheme>('competition');
  const [neighbours, setNeighbours] = useState(true);
  const [sectionLines, setSectionLines] = useState(true);
  const [scaleSel, setScaleSel] = useState<number | 'auto'>('auto');
  const [storeySel, setStoreySel] = useState<number | null>(null);

  // floor plans: schematic unit layouts of all masses (pure, from the analysis)
  const layouts = useMemo(
    () =>
      view === 'floorPlan' && project && analysis
        ? massLayouts(analysis.result, project.settings)
        : null,
    [view, project, analysis],
  );
  const storeyOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const ml of layouts ?? [])
      for (const s of ml.storeys) if (!m.has(s.storeyIndex)) m.set(s.storeyIndex, s.label);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [layouts]);
  const storey =
    layouts && storeySel !== null && storeyOptions.some(([i]) => i === storeySel)
      ? storeySel
      : layouts
        ? typicalStorey(layouts)
        : 0;

  const texts = useMemo(
    () => ({ parapet: t('parapet'), ridge: t('ridge'), datum: t('datum') }),
    [t],
  );
  const model = useMemo(() => {
    if (!project || !analysis) return null;
    try {
      return buildDrawing(view, project, analysis.result, {
        scheme,
        neighbours,
        sectionLines,
        texts,
        storey,
        ...(layouts ? { layouts } : {}),
      });
    } catch (e) {
      console.error('drawing failed', e);
      return null;
    }
  }, [view, project, analysis, scheme, neighbours, sectionLines, texts, storey, layouts]);
  const scale = useMemo(
    () => (model ? (scaleSel === 'auto' ? chooseScale(model, ...AUTO_BOX) : scaleSel) : 500),
    [model, scaleSel],
  );
  const svg = useMemo(() => (model ? renderSvg(model, { scale }) : ''), [model, scale]);
  const size = useMemo(() => {
    const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
    return m ? { w: Number(m[1]) * PX_PER_MM, h: Number(m[2]) * PX_PER_MM } : { w: 0, h: 0 };
  }, [svg]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [vs, setVs] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el || !size.w) return;
    const r = el.getBoundingClientRect();
    // floor plans: keep the legend (left) free
    const left = (leftOpen ? 390 : 88) + (view === 'floorPlan' ? 290 : 0);
    const right = inspectorOpen ? 336 : 32;
    const top = 156;
    const bottom = 104;
    const aw = Math.max(200, r.width - left - right);
    const ah = Math.max(200, r.height - top - bottom);
    const k = Math.min(aw / size.w, ah / size.h, 4);
    setVs({ k, x: left + (aw - size.w * k) / 2, y: top + (ah - size.h * k) / 2 });
  }, [size.w, size.h, leftOpen, inspectorOpen, view]);
  // refit when the view or the sheet size changes
  const fitKey = `${view}|${scale}|${Math.round(size.w)}|${Math.round(size.h)}`;
  const lastFit = useRef('');
  useLayoutEffect(() => {
    if (lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    fit();
  }, [fitKey, fit]);

  // wheel zoom around the cursor (non-passive listener)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setVs((v) => {
        const k = Math.min(40, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k / v.k;
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setVs((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => (drag.current = null);
  const zoomBy = (f: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = r.width / 2;
    const py = r.height / 2;
    setVs((v) => ({ k: v.k * f, x: px - (px - v.x) * f, y: py - (py - v.y) * f }));
  };

  const title = t(`views.${view}`);
  const download = () => {
    if (!svg || !project) return;
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml' }),
      `${safeFileName(project.name)} - ${safeFileName(title)}.svg`,
    );
  };

  if (!project || !analysis) return <div className="placeholder">{t('noProject')}</div>;
  if (!model) return <div className="placeholder">{t('failed')}</div>;

  return (
    <div
      ref={stageRef}
      className="dv-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={fit}
    >
      <div
        className="dv-sheet"
        style={{
          width: size.w,
          height: size.h,
          transform: `translate(${vs.x}px, ${vs.y}px) scale(${vs.k})`,
        }}
      >
        <div className="dv-paper" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="dv-caption" style={{ transform: `scale(${1 / vs.k})` }}>
          <span className="dv-title">{title}</span>
          <span className="dv-scale">
            {t('scale')} 1:{scale}
          </span>
        </div>
      </div>

      {layouts && project && (
        <FloorPlanLegend
          layouts={layouts}
          storey={storey}
          mix={project.settings.unitMix}
          rules={resolveUnitRules(project.settings)}
        />
      )}

      <div className="dv-toolbar glass" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton icon={Maximize} label={t('fit')} onClick={fit} side="bottom" size={16} />
        <IconButton
          icon={Minus}
          label={t('zoomOut')}
          onClick={() => zoomBy(1 / 1.25)}
          side="bottom"
          size={16}
        />
        <IconButton
          icon={Plus}
          label={t('zoomIn')}
          onClick={() => zoomBy(1.25)}
          side="bottom"
          size={16}
        />
        <span className="dv-sep" />
        <label className="dv-field">
          <span className="sr-only">{t('scale')}</span>
          <select
            value={String(scaleSel)}
            onChange={(e) =>
              setScaleSel(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
            }
          >
            <option value="auto">
              {t('auto')} (1:{scaleSel === 'auto' ? scale : chooseScale(model, ...AUTO_BOX)})
            </option>
            {STANDARD_SCALES.map((s) => (
              <option key={s} value={s}>
                1:{s}
              </option>
            ))}
          </select>
        </label>
        {view === 'floorPlan' && (
          <label className="dv-field">
            <span className="dv-field-label">{t('fp.storey')}</span>
            <select value={storey} onChange={(e) => setStoreySel(Number(e.target.value))}>
              {storeyOptions.map(([i, label]) => (
                <option key={i} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {view !== 'floorPlan' && (
          <div className="dv-seg" role="group" aria-label={t('scheme')}>
            {(['competition', 'permit'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={scheme === s ? 'is-active' : ''}
                aria-pressed={scheme === s}
                onClick={() => setScheme(s)}
              >
                <span className={`dv-swatch dv-swatch-${s}`} />
                {t(`schemes.${s}`)}
              </button>
            ))}
          </div>
        )}
        <span className="dv-sep" />
        <IconButton
          icon={Building2}
          label={t('neighbours')}
          active={neighbours}
          onClick={() => setNeighbours((v) => !v)}
          side="bottom"
          size={16}
        />
        {view === 'site' && (
          <IconButton
            icon={Scissors}
            label={t('sectionLines')}
            active={sectionLines}
            onClick={() => setSectionLines((v) => !v)}
            side="bottom"
            size={16}
          />
        )}
        <IconButton
          icon={Download}
          label={t('downloadSvg')}
          onClick={download}
          side="bottom"
          size={16}
        />
      </div>
    </div>
  );
}
