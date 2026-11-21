import { ArrowRight, Clock, FolderOpen, MapPin, Plus, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { palaiseauDemo } from '../demo/palaiseau';
import { deleteRecent, listRecent, type RecentEntry } from '../persistence/autosave';
import { newProject, openFromAutosave, openFromFile, openProject } from './commands';
import { useShellStore } from './shellStore';
import { BrandMark, ThemeToggle } from './TopBar';

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
      <div className="start-mesh" aria-hidden>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="start-top">
        <BrandMark />
        <ThemeToggle />
      </div>
      <main className="start-hero">
        <span className="start-eyebrow">{t('start.eyebrow')}</span>
        <h1 className="start-title">{t('common:appName')}</h1>
        <p className="start-sub">{t('start.subtitle')}</p>
        <div className="start-actions">
          <button className="btn btn-primary btn-lg" onClick={newProject}>
            <Plus size={18} strokeWidth={2} /> {t('start.new')}
          </button>
          <button className="btn btn-glass btn-lg" onClick={() => void openFromFile()}>
            <FolderOpen size={17} strokeWidth={1.75} /> {t('start.open')}
          </button>
          <button className="btn btn-glass btn-lg" onClick={() => openProject(palaiseauDemo())}>
            <MapPin size={17} strokeWidth={1.75} /> {t('start.demo')}
          </button>
        </div>
        <section className="start-recent">
          <h2 className="label">{t('start.recent')}</h2>
          {recent === null ? (
            <p className="empty">…</p>
          ) : recent.length === 0 ? (
            <p className="empty">{t('start.noRecent')}</p>
          ) : (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.id} className="glass recent-card">
                  <button className="recent-open" onClick={() => void openFromAutosave(r.id)}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-date">
                      <Clock size={12} strokeWidth={1.75} /> {fmtDate(r.savedAt)}
                    </span>
                    <ArrowRight size={16} className="recent-go" />
                  </button>
                  <button
                    className="mini-btn recent-del"
                    title={t('common:actions.delete')}
                    aria-label={t('common:actions.delete')}
                    onClick={() =>
                      deleteRecent(r.id)
                        .then(refresh)
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    <Trash size={14} strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
