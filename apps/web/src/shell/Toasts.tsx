import { CircleAlert, CircleCheck, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShellStore } from './shellStore';

/** Bottom-right toasts for info / error / busy messages of the shell store. */
export function Toasts() {
  const { t } = useTranslation();
  const info = useShellStore((s) => s.info);
  const error = useShellStore((s) => s.error);
  const busy = useShellStore((s) => s.busy);
  // Info messages fade after a few seconds; errors stay until dismissed.
  useEffect(() => {
    if (!info) return;
    const id = setTimeout(() => useShellStore.getState().setInfo(null), 4000);
    return () => clearTimeout(id);
  }, [info]);
  return (
    <div className="toasts" aria-live="polite">
      {busy && (
        <div className="glass toast">
          <Loader2 size={16} strokeWidth={1.75} className="spin toast-icon" />
          <span>{t('shell:ribbon.loading')}</span>
        </div>
      )}
      {info && (
        <div className="glass toast toast-ok">
          <CircleCheck size={16} strokeWidth={1.75} className="toast-icon" />
          <span>{info}</span>
        </div>
      )}
      {error && (
        <div className="glass toast toast-error" role="alert">
          <CircleAlert size={16} strokeWidth={1.75} className="toast-icon" />
          <span>{error}</span>
          <button
            type="button"
            className="mini-btn"
            aria-label={t('common:actions.close')}
            onClick={() => useShellStore.getState().setError(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
