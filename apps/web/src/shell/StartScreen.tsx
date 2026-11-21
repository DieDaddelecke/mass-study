import { FilePlus, FolderOpen, MapPin, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { palaiseauDemo } from '../demo/palaiseau';
import { deleteRecent, listRecent, type RecentEntry } from '../persistence/autosave';
import { newProject, openFromAutosave, openFromFile, openProject } from './commands';
import { useShellStore } from './shellStore';

export function StartScreen() {
  const { t, i18n } = useTranslation('shell');
  const [recent, setRecent] = useState<RecentEntry[] | null>(null);
  const setError = useShellStore((s) => s.setError);

  const refresh = () =>
    listRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  useEffect(() => {
    void refresh();
  }, []);

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <div className="start">
      <div className="start-card">
        <h1>{t('common:appName')}</h1>
        <p className="start-sub">{t('start.subtitle')}</p>
        <div className="start-actions">
          <button className="btn btn-primary" onClick={newProject}>
            <FilePlus size={16} /> {t('start.new')}
          </button>
          <button className="btn" onClick={() => void openFromFile()}>
            <FolderOpen size={16} /> {t('start.open')}
          </button>
          <button className="btn" onClick={() => openProject(palaiseauDemo())}>
            <MapPin size={16} /> {t('start.demo')}
          </button>
        </div>
        <h2>{t('start.recent')}</h2>
        {recent === null ? (
          <p className="muted">…</p>
        ) : recent.length === 0 ? (
          <p className="muted">{t('start.noRecent')}</p>
        ) : (
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.id}>
                <button className="recent-open" onClick={() => void openFromAutosave(r.id)}>
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-date">{fmtDate(r.savedAt)}</span>
                </button>
                <button
                  className="icon-btn"
                  title={t('common:actions.delete')}
                  aria-label={t('common:actions.delete')}
                  onClick={() =>
                    deleteRecent(r.id)
                      .then(refresh)
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  <Trash size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
