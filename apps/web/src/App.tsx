import * as Tooltip from '@radix-ui/react-tooltip';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { TopLeft, TopRight } from './shell/TopBar';
import { ToolDock } from './shell/ToolDock';
import { LeftPanel } from './shell/LeftPanel';
import { Inspector } from './shell/Inspector';
import { ToolPill } from './shell/ToolPill';
import { KpiBar, WarningsPill } from './shell/KpiBar';
import { Toasts } from './shell/Toasts';
import { CommandPalette } from './shell/CommandPalette';
import { StartScreen } from './shell/StartScreen';
import { Dialogs } from './shell/Dialogs';
import { IconButton } from './shell/ui';
import { useShortcuts } from './shell/shortcuts';
import { openProject } from './shell/commands';
import { useShellStore } from './shell/shellStore';
import { startAutosave } from './persistence/autosave';
import { useResolvedTheme } from './theme/themeStore';
import { Viewport3D } from './viewport/Viewport3D';
import { DrawingView } from './drawings/DrawingView';
import { TablesView } from './tables/TablesView';
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
 * Full-bleed canvas with floating glass panels. Each region is owned by one module:
 *   shell/*       top bar, tool dock, side panels, inspector, KPI strip, palette, dialogs, toasts
 *   viewport/*    the 3D view (scene, nav cube, view controls, tools, snapping, grips)
 *   newProject/*  the "Nouveau projet" dialog with map, cadastre, import
 *   persistence/* autosave (IndexedDB) and *.massing.json files
 *   drawings/*    2D views from @kubatur/drawing (site plan, elevations, sections, axonometry)
 *   tables/*      schedules and XLSX/CSV export
 *   exports/*     file exports (IFC, XLSX, CSV, PDF)
 */
export function App() {
  const { t } = useTranslation('shell');
  const theme = useResolvedTheme();
  const hasProject = useProjectStore((s) => s.project !== null);
  const activeView = useUiStore((s) => s.activeView);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const inspectorOpen = useShellStore((s) => s.inspectorOpen);
  useShortcuts();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(
    () => startAutosave(undefined, () => useShellStore.getState().setError(t('errors.autosave'))),
    [t],
  );

  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
      <div className={`app${leftOpen ? ' has-left' : ''}${inspectorOpen ? ' has-right' : ''}`}>
        {!hasProject ? (
          <StartScreen />
        ) : (
          <>
            <main className="stage">
              {activeView === '3d' ? (
                <Viewport3D />
              ) : activeView === 'areas' ? (
                <TablesView />
              ) : (
                <DrawingView view={activeView} />
              )}
            </main>
            <div className="ui-layer">
              <div className="region-top-left">
                <TopLeft />
                {leftOpen ? (
                  <LeftPanel />
                ) : (
                  <div className="glass collapsed-tab">
                    <IconButton
                      icon={PanelLeftOpen}
                      label={t('panel.expand')}
                      side="right"
                      size={16}
                      onClick={() => useShellStore.getState().setLeftOpen(true)}
                    />
                  </div>
                )}
              </div>
              <ToolDock />
              <div className="region-top-right">
                <TopRight />
                {inspectorOpen ? (
                  <Inspector />
                ) : (
                  <div className="glass collapsed-tab collapsed-right">
                    <IconButton
                      icon={PanelRightOpen}
                      label={t('inspector.title')}
                      side="left"
                      size={16}
                      onClick={() => useShellStore.getState().setInspectorOpen(true)}
                    />
                  </div>
                )}
              </div>
              <ToolPill />
              <div className="region-bottom">
                <KpiBar />
                <WarningsPill />
              </div>
            </div>
          </>
        )}
        <Toasts />
        <CommandPalette />
        <Dialogs />
        {newProjectOpen && <NewProjectDialog />}
      </div>
    </Tooltip.Provider>
  );
}
