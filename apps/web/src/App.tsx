import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { Ribbon } from './shell/Ribbon';
import { OptionsBar } from './shell/OptionsBar';
import { PropertiesPalette } from './shell/PropertiesPalette';
import { ProjectBrowser } from './shell/ProjectBrowser';
import { ViewTabs } from './shell/ViewTabs';
import { StatusBar } from './shell/StatusBar';
import { KpiBar } from './shell/KpiBar';
import { StartScreen } from './shell/StartScreen';
import { Dialogs, ErrorBanner } from './shell/Dialogs';
import { useShortcuts } from './shell/shortcuts';
import { openProject } from './shell/commands';
import { useShellStore } from './shell/shellStore';
import { startAutosave } from './persistence/autosave';
import { Viewport3D } from './viewport/Viewport3D';
import { NewProjectDialog } from './newProject/NewProjectDialog';
import { palaiseauDemo } from './demo/palaiseau';

// `?demo=palaiseau` loads an offline demo project (recorded real data).
if (
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === 'palaiseau'
) {
  openProject(palaiseauDemo());
}

/**
 * Revit-like application frame (SPEC §9). Each region is owned by one module:
 *   shell/*       ribbon, options bar, properties, project browser, view tabs, KPI and status bars
 *   viewport/*    the 3D view (scene, nav cube, tools, snapping, grips)
 *   newProject/*  the "Nouveau projet" dialog with map, cadastre, import
 *   persistence/* autosave (IndexedDB) and *.massing.json files
 */
export function App() {
  const { t } = useTranslation('shell');
  const hasProject = useProjectStore((s) => s.project !== null);
  const activeView = useUiStore((s) => s.activeView);
  const openViews = useUiStore((s) => s.openViews);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  useShortcuts();
  useEffect(
    () => startAutosave(undefined, () => useShellStore.getState().setError(t('errors.autosave'))),
    [t],
  );
  // The info message in the status bar fades after a few seconds.
  const info = useShellStore((s) => s.info);
  useEffect(() => {
    if (!info) return;
    const id = setTimeout(() => useShellStore.getState().setInfo(null), 4000);
    return () => clearTimeout(id);
  }, [info]);

  let view;
  if (!hasProject) view = <StartScreen />;
  else if (!openViews.length) view = <div className="placeholder">{t('views.none')}</div>;
  else if (activeView === '3d') view = <Viewport3D />;
  else view = <div className="placeholder">{t('common:inPreparation')}</div>;

  return (
    <div className="app">
      <header className="app-ribbon">
        <Ribbon />
      </header>
      <div className="app-options">
        <OptionsBar />
      </div>
      <aside className="app-side">
        <section className="app-properties">
          <PropertiesPalette />
        </section>
        <section className="app-browser">
          <ProjectBrowser />
        </section>
      </aside>
      <main className="app-main">
        <ViewTabs />
        <div className="app-view">
          {view}
          <ErrorBanner />
        </div>
      </main>
      <footer className="app-footer">
        <KpiBar />
        <StatusBar />
      </footer>
      <Dialogs />
      {newProjectOpen && <NewProjectDialog />}
    </div>
  );
}
