import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Box,
  Check,
  ChevronDown,
  House,
  Layers,
  Magnet,
  Maximize,
  Palette,
  SquareDashed,
  Sun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VisualStyle } from '../store/tools';
import { useUiStore } from '../store/uiStore';
import { useViewportStore } from './viewportStore';
import { LIT_STYLES } from './scene/looks';
import { useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { defaultCutLevel } from './scene/storeyCut';
import { massLayouts } from '@kubatur/core';

const STYLES: VisualStyle[] = [
  'wireframe',
  'hiddenLine',
  'shaded',
  'consistentColors',
  'granulometry',
  'realistic',
];

/** 3D ↔ plan switch: both are editable working views of the same scene. */
function ModeSwitch({ plan }: { plan: boolean }) {
  const { t } = useTranslation('viewport');
  const openView = useUiStore((s) => s.openView);
  return (
    <div className="vp-mode" role="radiogroup" aria-label={t('plan.mode')}>
      {(
        [
          ['3d', Box, t('plan.to3d'), !plan],
          ['plan', SquareDashed, t('plan.toPlan'), plan],
        ] as const
      ).map(([id, Icon, label, on]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={on}
          className={`vp-mode-btn${on ? ' is-on' : ''}`}
          title={label}
          onClick={() => openView(id)}
        >
          <Icon size={14} strokeWidth={1.75} />
          <span>{id === '3d' ? '3D' : t('plan.short')}</span>
        </button>
      ))}
    </div>
  );
}

/** Floating view controls (bottom-left): 3D/plan, visual style, sun, projection, zoom, home. */
export function ViewControlBar({ plan = false }: { plan?: boolean }) {
  const { t } = useTranslation('viewport');
  const style = useUiStore((s) => s.visualStyle);
  const setStyle = useUiStore((s) => s.setVisualStyle);
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const sun = useViewportStore((s) => (plan ? s.planSun : s.sunEnabled));
  const setSun = useViewportStore((s) => (plan ? s.setPlanSun : s.setSunEnabled));
  const zoomExtents = useViewportStore((s) => s.requestZoomExtents);
  const home = useViewportStore((s) => s.requestHome);
  const sunActive = LIT_STYLES.has(style) && sun;
  const magnet = useUiStore((s) => s.snap.enabled && s.snap.magnet);
  const setSnap = useUiStore((s) => s.setSnap);
  const persp = projection === 'perspective';
  const cutLevel = useViewportStore((s) => s.cutLevel);
  const setCutLevel = useViewportStore((s) => s.setCutLevel);
  const project = useProjectStore((s) => s.project);
  const analysis = useAnalysis();
  const toggleCut = () => {
    if (cutLevel !== null) return setCutLevel(null);
    if (!project || !analysis) return;
    let layouts = null;
    try {
      layouts = massLayouts(analysis.result, project.settings);
    } catch {
      /* no dwellings: highest storey */
    }
    setCutLevel(
      defaultCutLevel(
        analysis.result.solids.map((r) => r.solid),
        layouts,
      ),
    );
  };
  return (
    <div className="glass vp-bar" role="toolbar" aria-label={t('bar.label')}>
      <ModeSwitch plan={plan} />
      <span className="vp-bar-sep" />
      <Menu.Root>
        <Menu.Trigger
          className="vp-style"
          aria-label={t('bar.visualStyle')}
          title={t('bar.visualStyle')}
        >
          <Palette size={15} strokeWidth={1.75} />
          <span>{t(`style.${style}`)}</span>
          <ChevronDown size={13} strokeWidth={1.75} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu glass" side="top" align="start" sideOffset={10}>
            <Menu.Label className="menu-label">{t('bar.visualStyle')}</Menu.Label>
            {STYLES.map((s) => (
              <Menu.Item key={s} className="menu-item" onSelect={() => setStyle(s)}>
                <span className="menu-check">{s === style && <Check size={14} />}</span>
                {t(`style.${s}`)}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <span className="vp-bar-sep" />
      <button
        type="button"
        className={`vp-bar-btn${sunActive ? ' is-on' : ''}`}
        title={t('bar.sun')}
        aria-label={t('bar.sun')}
        aria-pressed={sunActive}
        onClick={() => {
          if (!LIT_STYLES.has(style)) {
            setStyle('shaded');
            setSun(true);
          } else setSun(!sun);
        }}
      >
        <Sun size={16} strokeWidth={1.75} />
      </button>
      {!plan && (
        <button
          type="button"
          className="vp-bar-btn vp-proj"
          title={persp ? t('bar.toOrtho') : t('bar.toPersp')}
          aria-label={persp ? t('bar.toOrtho') : t('bar.toPersp')}
          onClick={() => setProjection(persp ? 'orthographic' : 'perspective')}
        >
          <Box size={16} strokeWidth={1.75} />
          <span>{persp ? t('bar.persp') : t('bar.ortho')}</span>
        </button>
      )}
      <button
        type="button"
        className={`vp-bar-btn${magnet ? ' is-on' : ''}`}
        title={t('bar.magnet')}
        aria-label={t('bar.magnet')}
        aria-pressed={magnet}
        onClick={() => setSnap(magnet ? { magnet: false } : { magnet: true, enabled: true })}
      >
        <Magnet size={16} strokeWidth={1.75} />
      </button>
      {!plan && (
        <button
          type="button"
          className={`vp-bar-btn${cutLevel !== null ? ' is-on' : ''}`}
          title={t('bar.cut')}
          aria-label={t('bar.cut')}
          aria-pressed={cutLevel !== null}
          disabled={!analysis?.result.solids.length}
          onClick={toggleCut}
        >
          <Layers size={16} strokeWidth={1.75} />
        </button>
      )}
      <span className="vp-bar-sep" />
      <button
        type="button"
        className="vp-bar-btn"
        title={t('bar.zoomExtents')}
        aria-label={t('bar.zoomExtents')}
        onClick={zoomExtents}
      >
        <Maximize size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="vp-bar-btn"
        title={t('cube.home')}
        aria-label={t('cube.home')}
        onClick={home}
      >
        <House size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
