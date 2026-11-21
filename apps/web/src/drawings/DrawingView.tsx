import { useTranslation } from 'react-i18next';
import type { ViewId } from '../store/tools';

/**
 * 2D views (site plan, elevations, sections, axonometry) rendered from `@kubatur/drawing`.
 * Placeholder until the drawing engine (P6) lands.
 */
export function DrawingView({ view }: { view: Exclude<ViewId, '3d' | 'areas'> }) {
  const { t } = useTranslation('shell');
  return (
    <div className="placeholder">
      {t(`views.${view}`)} – {t('common:inPreparation')}
    </div>
  );
}
