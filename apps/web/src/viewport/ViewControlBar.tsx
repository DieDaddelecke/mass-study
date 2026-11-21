import { Box, EyeOff, Maximize, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VisualStyle } from '../store/tools';
import { useUiStore } from '../store/uiStore';
import { useViewportStore } from './viewportStore';

const STYLES: VisualStyle[] = [
  'wireframe',
  'hiddenLine',
  'shaded',
  'consistentColors',
  'realistic',
];

/** Small Revit-like view control bar at the bottom of the viewport. */
export function ViewControlBar() {
  const { t } = useTranslation('viewport');
  const style = useUiStore((s) => s.visualStyle);
  const setStyle = useUiStore((s) => s.setVisualStyle);
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const sun = useViewportStore((s) => s.sunEnabled);
  const setSun = useViewportStore((s) => s.setSunEnabled);
  const zoomExtents = useViewportStore((s) => s.requestZoomExtents);
  const sunActive = style === 'realistic' && sun;
  return (
    <div className="vp-bar" role="toolbar" aria-label={t('bar.label')}>
      <span className="vp-bar-scale" aria-disabled title={t('bar.scaleDisabled')}>
        1:200
      </span>
      <span className="vp-bar-sep" />
      <select
        className="vp-bar-select"
        value={style}
        title={t('bar.visualStyle')}
        aria-label={t('bar.visualStyle')}
        onChange={(e) => setStyle(e.target.value as VisualStyle)}
      >
        {STYLES.map((s) => (
          <option key={s} value={s}>
            {t(`style.${s}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`vp-bar-btn${sunActive ? ' is-on' : ''}`}
        title={t('bar.sun')}
        aria-pressed={sunActive}
        onClick={() => {
          if (style !== 'realistic') {
            setStyle('realistic');
            setSun(true);
          } else setSun(!sun);
        }}
      >
        <Sun size={15} />
      </button>
      <button
        type="button"
        className={`vp-bar-btn${projection === 'perspective' ? ' is-on' : ''}`}
        title={projection === 'perspective' ? t('bar.toOrtho') : t('bar.toPersp')}
        aria-pressed={projection === 'perspective'}
        onClick={() => setProjection(projection === 'perspective' ? 'orthographic' : 'perspective')}
      >
        <Box size={15} />
      </button>
      <button
        type="button"
        className="vp-bar-btn"
        title={t('bar.zoomExtents')}
        onClick={zoomExtents}
      >
        <Maximize size={15} />
      </button>
      <span className="vp-bar-sep" />
      <button
        type="button"
        className="vp-bar-btn"
        disabled
        title={`${t('bar.isolate')} – ${t('bar.soon')}`}
      >
        <EyeOff size={15} />
      </button>
    </div>
  );
}
