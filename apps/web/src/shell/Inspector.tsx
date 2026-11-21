import { PanelRightClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PropertiesPalette } from './PropertiesPalette';
import { useShellStore } from './shellStore';
import { IconButton } from './ui';

/** Right panel: properties of the selection, or project / site summary. */
export function Inspector() {
  const { t } = useTranslation('shell');
  const setOpen = useShellStore((s) => s.setInspectorOpen);
  return (
    <aside className="glass panel inspector" aria-label={t('inspector.title')}>
      <div className="panel-head">
        <span className="panel-title">{t('inspector.title')}</span>
        <IconButton
          icon={PanelRightClose}
          label={t('panel.collapse')}
          size={16}
          onClick={() => setOpen(false)}
        />
      </div>
      <div className="inspector-scroll">
        <PropertiesPalette />
      </div>
    </aside>
  );
}
