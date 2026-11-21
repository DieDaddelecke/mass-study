import { useTranslation } from 'react-i18next';

/** Schedules (area table, KPIs, typologies/mix) with XLSX/CSV export. Placeholder until P5. */
export function TablesView() {
  const { t } = useTranslation('shell');
  return (
    <div className="placeholder">
      {t('views.areas')} – {t('common:inPreparation')}
    </div>
  );
}
