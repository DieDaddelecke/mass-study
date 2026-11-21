import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

export function ViewTabs() {
  const { t } = useTranslation('shell');
  const hasProject = useProjectStore((s) => s.project !== null);
  const openViews = useUiStore((s) => s.openViews);
  const active = useUiStore((s) => s.activeView);
  const openView = useUiStore((s) => s.openView);
  const closeView = useUiStore((s) => s.closeView);
  if (!hasProject) return <div className="viewtabs" />;
  return (
    <div className="viewtabs" role="tablist">
      {openViews.map((v) => (
        <div
          key={v}
          className={`viewtab${v === active ? ' active' : ''}`}
          role="tab"
          aria-selected={v === active}
        >
          <button className="viewtab-label" onClick={() => openView(v)}>
            {v === '3d' ? '{3D}' : t(`views.${v}`)}
          </button>
          <button
            className="icon-btn"
            title={t('common:actions.close')}
            aria-label={t('common:actions.close')}
            onClick={() => closeView(v)}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
