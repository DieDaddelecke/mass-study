import { USAGES, type MassLayout, type UnitType } from '@kubatur/core';
import { unitColor } from '@kubatur/drawing';
import { GRANULO_COLORS } from './scene/granulometry';
import { useTranslation } from 'react-i18next';
import { usageColor } from './scene/colors';

/** Usage legend for the "consistent colours" style. */
export function UsageLegend() {
  const { t } = useTranslation('viewport');
  const { t: tc } = useTranslation('common');
  return (
    <div className="glass vp-legend" aria-label={t('legend.title')}>
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

/** Legend of the granulometry style: dwelling types with count and share (all masses). */
export function GranulometryLegend({
  layouts,
  mix,
}: {
  layouts: readonly MassLayout[];
  mix: readonly UnitType[];
}) {
  const { t } = useTranslation('viewport');
  const rows = mix
    .map((type) => ({
      type,
      count: layouts.reduce(
        (s, m) => s + (m.totals.byType.find((b) => b.typeId === type.id)?.count ?? 0),
        0,
      ),
    }))
    .filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="glass vp-legend" aria-label={t('legend.granuloTitle')}>
      <div className="vp-legend-title">{t('legend.granuloTitle')}</div>
      {total === 0 && <div className="vp-legend-row">{t('legend.none')}</div>}
      {rows.map((r) => (
        <div key={r.type.id} className="vp-legend-row">
          <span className="vp-legend-swatch" style={{ background: unitColor(r.type.id, mix) }} />
          <span className="vp-legend-label">{r.type.label}</span>
          <span className="vp-legend-num">{r.count}</span>
          <span className="vp-legend-num muted">{Math.round((100 * r.count) / total)} %</span>
        </div>
      ))}
      {total > 0 && (
        <div className="vp-legend-row vp-legend-total">
          <span className="vp-legend-swatch" style={{ visibility: 'hidden' }} />
          <span className="vp-legend-label">
            {total} {t('legend.units')}
          </span>
        </div>
      )}
      <div className="vp-legend-row">
        <span className="vp-legend-swatch" style={{ background: GRANULO_COLORS.core }} />
        {t('legend.core')}
      </div>
      <div className="vp-legend-row">
        <span className="vp-legend-swatch" style={{ background: GRANULO_COLORS.circulation }} />
        {t('legend.circulation')}
      </div>
    </div>
  );
}
