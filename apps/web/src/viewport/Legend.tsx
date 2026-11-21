import { USAGES } from '@kubatur/core';
import { useTranslation } from 'react-i18next';
import { usageColor } from './scene/colors';

/** Usage legend for the "consistent colours" style. */
export function UsageLegend() {
  const { t } = useTranslation('viewport');
  const { t: tc } = useTranslation('common');
  return (
    <div className="vp-legend" aria-label={t('legend.title')}>
      <div className="vp-legend-title">{t('legend.title')}</div>
      {USAGES.map((u) => (
        <div key={u} className="vp-legend-row">
          <span className="vp-legend-swatch" style={{ background: usageColor(u) }} />
          {tc(`usage.${u}`)}
        </div>
      ))}
    </div>
  );
}
