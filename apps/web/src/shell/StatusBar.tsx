import { Magnet, Plug, TriangleExclamationPoint } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useAnalysis } from '../store/useAnalysis';
import { useUiStore } from '../store/uiStore';
import { useShellStore } from './shellStore';

export function StatusBar() {
  const { t, i18n } = useTranslation('shell');
  const hint = useUiStore((s) => s.hint);
  const cursor = useUiStore((s) => s.cursor);
  const snap = useUiStore((s) => s.snap.enabled);
  const setSnap = useUiStore((s) => s.setSnap);
  const analysis = useAnalysis();
  const setDialog = useShellStore((s) => s.setDialog);
  const info = useShellStore((s) => s.info);
  const busy = useShellStore((s) => s.busy);
  const warnings = analysis?.warnings ?? [];
  const errors = warnings.filter((w) => w.severity === 'error').length;
  const f = (v: number) => formatNumber(v, 2, i18n.language);
  return (
    <div className="statusbar">
      <span className="sb-hint">
        {busy ? t('ribbon.loading') : hint || info || t('status.ready')}
      </span>
      <span className="sb-cell sb-coords">
        {cursor ? `X ${f(cursor[0])}  Y ${f(cursor[1])}` : 'X —  Y —'}
      </span>
      <button
        className={`sb-cell sb-btn${snap ? ' on' : ''}`}
        aria-pressed={snap}
        title={t('status.snapTitle')}
        onClick={() => setSnap({ enabled: !snap })}
      >
        <Magnet size={12} /> {t('status.snap')}
      </button>
      <button
        className={`sb-cell sb-btn sb-warn${errors ? ' has-error' : warnings.length ? ' has-warning' : ''}`}
        title={t('status.warningsTitle')}
        onClick={() => setDialog('warnings')}
        disabled={!analysis}
      >
        <TriangleExclamationPoint size={12} /> {warnings.length}
      </button>
      <span className="sb-cell sb-muted" title={t('common:inPreparation')}>
        <Plug size={12} /> {t('status.archicad')}
      </span>
    </div>
  );
}
