import type { Project } from '@kubatur/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShellStore } from '../shell/shellStore';
import { Dialog } from '../shell/ui';
import { exportActiveVariantIfc, IFC_ARCHICAD_DEFAULTS, type IfcExportFlags } from './ifc';

const FLAGS: (keyof IfcExportFlags)[] = ['spaces', 'slabs', 'massProxies', 'context'];

/** IFC4 export options + short Archicad import hint (SPEC §13, §14 A). */
export function IfcExportDialog({ project }: { project: Project }) {
  const { t } = useTranslation('exports');
  const [flags, setFlags] = useState<IfcExportFlags>(IFC_ARCHICAD_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const shell = useShellStore.getState();
  const close = () => shell.setDialog(null);
  const run = async () => {
    setBusy(true);
    try {
      await exportActiveVariantIfc(project, flags);
      shell.setInfo(t('ifc.done'));
      close();
    } catch (e) {
      console.error('IFC export failed', e);
      shell.setError(t('ifc.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={t('ifc.title')}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t('common:actions.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {t('ifc.export')}
          </button>
        </>
      }
    >
      <p className="muted">{t('ifc.intro')}</p>
      <ul className="list">
        {FLAGS.map((k) => (
          <li key={k}>
            <label className="list-row">
              <span className="list-text">{t(`ifc.options.${k}`)}</span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={flags[k]}
                onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })}
                aria-label={t(`ifc.options.${k}`)}
              />
            </label>
          </li>
        ))}
      </ul>
      <h3 className="label">{t('ifc.archicad.title')}</h3>
      <ul className="muted">
        <li>{t('ifc.archicad.merge')}</li>
        <li>{t('ifc.archicad.hotlink')}</li>
        <li>{t('ifc.archicad.origin')}</li>
      </ul>
    </Dialog>
  );
}
