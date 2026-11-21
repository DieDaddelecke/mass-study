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
import { Viewport3D } from './viewport/Viewport3D';
import { NewProjectDialog } from './newProject/NewProjectDialog';
import { palaiseauDemo } from './demo/palaiseau';

// `?demo=palaiseau` loads an offline demo project (recorded real data).
if (
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === 'palaiseau'
) {
  useProjectStore.getState().load(palaiseauDemo());
}

/**
 * Revit-like application frame (SPEC §9). Each region is owned by one module:
 *   shell/*       ribbon, options bar, properties, project browser, view tabs, KPI and status bars
 *   viewport/*    the 3D view (scene, nav cube, tools, snapping, grips)
 *   newProject/*  the "Nouveau projet" dialog with map, cadastre, import
 */
export function App() {
  const hasProject = useProjectStore((s) => s.project !== null);
  const activeView = useUiStore((s) => s.activeView);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);

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
          {!hasProject ? <StartScreen /> : activeView === '3d' ? <Viewport3D /> : <Viewport3D />}
        </div>
      </main>
      <footer className="app-footer">
        <KpiBar />
        <StatusBar />
      </footer>
      {newProjectOpen && <NewProjectDialog />}
    </div>
  );
}
