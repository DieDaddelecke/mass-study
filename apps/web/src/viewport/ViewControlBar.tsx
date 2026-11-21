import * as Menu from '@radix-ui/react-dropdown-menu';
import { Box, Check, ChevronDown, House, Maximize, Palette, Sun } from 'lucide-react';
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

/** Floating view controls (bottom-left): visual style, sun, projection, zoom, home. */
export function ViewControlBar() {
  const { t } = useTranslation('viewport');
  const style = useUiStore((s) => s.visualStyle);
  const setStyle = useUiStore((s) => s.setVisualStyle);
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const sun = useViewportStore((s) => s.sunEnabled);
  const setSun = useViewportStore((s) => s.setSunEnabled);
  const zoomExtents = useViewportStore((s) => s.requestZoomExtents);
  const home = useViewportStore((s) => s.requestHome);
  const sunActive = style === 'realistic' && sun;
  const persp = projection === 'perspective';
  return (
    <div className="glass vp-bar" role="toolbar" aria-label={t('bar.label')}>
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
          if (style !== 'realistic') {
            setStyle('realistic');
            setSun(true);
          } else setSun(!sun);
        }}
      >
        <Sun size={16} strokeWidth={1.75} />
      </button>
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
