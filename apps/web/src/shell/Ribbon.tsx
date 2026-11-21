import type { TemplateId, TypologyKind } from '@kubatur/core';
import {
  AlignStartVertical,
  ArrowLeft,
  Box,
  Columns3,
  Copy,
  Cuboid,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  Frame,
  GitBranch,
  Grid3x3,
  House,
  LandPlot,
  LayoutGrid,
  Link,
  Maximize,
  Move,
  Pentagon,
  Plug,
  Redo2,
  RefreshCw,
  RotateCw,
  Rows3,
  Save,
  SaveAll,
  Scale,
  ScanLine,
  Settings,
  Spline,
  SquareDashed,
  SquareSplitHorizontal,
  Table,
  Trash,
  TriangleExclamationPoint,
  Undo2,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { activeVariant, useProjectStore } from '../store/projectStore';
import type { ToolState, VisualStyle } from '../store/tools';
import { useUiStore } from '../store/uiStore';
import {
  activateTool,
  closeProject,
  deleteSelection,
  isToolImplemented,
  newProject,
  openFromFile,
  placeTool,
  redo,
  reloadContext,
  save,
  saveAs,
  undo,
  zoomExtents,
} from './commands';
import { useShellStore, type RibbonTab } from './shellStore';
import { NumField } from './ui';

interface BtnProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Tooltip; disabled buttons show "en préparation" unless another reason is given. */
  title?: string;
  active?: boolean;
  shortcut?: string;
}

function useInPrep() {
  const { t } = useTranslation();
  return t('common:inPreparation');
}

function LargeButton(p: BtnProps) {
  const prep = useInPrep();
  const Icon = p.icon;
  const title =
    (p.disabled ? (p.title ?? prep) : p.title) ??
    (p.shortcut ? `${p.label} (${p.shortcut})` : p.label);
  return (
    <button
      type="button"
      className={`rb-large${p.active ? ' active' : ''}`}
      onClick={p.onClick}
      disabled={p.disabled || !p.onClick}
      title={title}
    >
      <Icon size={26} strokeWidth={1.4} />
      <span>{p.label}</span>
    </button>
  );
}

function SmallButton(p: BtnProps) {
  const prep = useInPrep();
  const Icon = p.icon;
  const title =
    (p.disabled ? (p.title ?? prep) : p.title) ??
    (p.shortcut ? `${p.label} (${p.shortcut})` : p.label);
  return (
    <button
      type="button"
      className={`rb-small${p.active ? ' active' : ''}`}
      onClick={p.onClick}
      disabled={p.disabled || !p.onClick}
      title={title}
    >
      <Icon size={15} strokeWidth={1.6} />
      <span>{p.label}</span>
      {p.shortcut && <kbd>{p.shortcut}</kbd>}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rb-panel">
      <div className="rb-panel-body">{children}</div>
      <div className="rb-panel-title">{title}</div>
    </div>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="rb-stack">{children}</div>;
}

const TABS: RibbonTab[] = [
  'file',
  'site',
  'volume',
  'modify',
  'view',
  'analysis',
  'output',
  'archicad',
];

export function Ribbon() {
  const { t } = useTranslation('shell');
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const tab = useShellStore((s) => s.tab);
  const setTab = useShellStore((s) => s.setTab);
  const hasMassSelection =
    !!project && activeVariant(project).masses.some((m) => selection.includes(m.id));

  // Contextual tab appears with a selection (Revit) and disappears with it.
  useEffect(() => {
    const st = useShellStore.getState();
    if (hasMassSelection && st.tab !== 'file') st.setTab('context');
    else if (!hasMassSelection && st.tab === 'context') st.setTab('modify');
  }, [hasMassSelection]);

  const title = project ? `${project.name} – ${activeVariant(project).name}` : t('app.title');

  return (
    <div className="ribbon">
      <div className="rb-qat">
        <span className="rb-logo">{t('common:appName')}</span>
        <button className="icon-btn" title={t('qat.save')} onClick={save} disabled={!project}>
          <Save size={14} />
        </button>
        <button className="icon-btn" title={t('qat.undo')} onClick={undo} disabled={!project}>
          <Undo2 size={14} />
        </button>
        <button className="icon-btn" title={t('qat.redo')} onClick={redo} disabled={!project}>
          <Redo2 size={14} />
        </button>
        <span className="rb-title">{title}</span>
      </div>
      <div className="rb-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`rb-tab${tab === id ? ' active' : ''}${id === 'file' ? ' rb-tab-file' : ''}`}
            onClick={() => setTab(id)}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
        {hasMassSelection && (
          <button
            role="tab"
            aria-selected={tab === 'context'}
            className={`rb-tab rb-tab-context${tab === 'context' ? ' active' : ''}`}
            onClick={() => setTab('context')}
          >
            {t('tabs.context')}
          </button>
        )}
      </div>
      <div className="rb-body">
        {tab === 'file' ? (
          <FileTabInline />
        ) : !project && tab !== 'view' ? (
          <div className="rb-empty">{t('ribbon.noProject')}</div>
        ) : (
          <TabContent tab={tab} />
        )}
      </div>
      {tab === 'file' && <Backstage />}
    </div>
  );
}

function FileTabInline() {
  return <div className="rb-empty" />;
}

function TabContent({ tab }: { tab: RibbonTab }) {
  switch (tab) {
    case 'site':
      return <SiteTab />;
    case 'volume':
      return <VolumeTab />;
    case 'modify':
      return <ModifyTab />;
    case 'context':
      return <ModifyTab contextual />;
    case 'view':
      return <ViewTab />;
    case 'analysis':
      return <AnalysisTab />;
    case 'output':
      return <OutputTab />;
    case 'archicad':
      return <ArchicadTab />;
    default:
      return null;
  }
}

function Backstage() {
  const { t } = useTranslation('shell');
  const project = useProjectStore((s) => s.project);
  const setTab = useShellStore((s) => s.setTab);
  const setDialog = useShellStore((s) => s.setDialog);
  const back = () => setTab(project ? 'volume' : 'volume');
  const run = (f: () => void) => () => {
    back();
    f();
  };
  const prep = t('common:inPreparation');
  return (
    <div className="backstage" role="dialog" aria-label={t('tabs.file')}>
      <nav className="bs-nav">
        <button className="bs-back" onClick={back} title={t('backstage.back')}>
          <ArrowLeft size={18} />
        </button>
        <button onClick={run(newProject)}>
          <FilePlus size={16} /> {t('file.new')}
        </button>
        <button onClick={run(() => void openFromFile())}>
          <FolderOpen size={16} /> {t('file.open')}
        </button>
        <button onClick={run(save)} disabled={!project}>
          <Save size={16} /> {t('file.save')} <kbd>Ctrl+S</kbd>
        </button>
        <button onClick={run(saveAs)} disabled={!project}>
          <SaveAll size={16} /> {t('file.saveAs')}
        </button>
        <div className="bs-sep">{t('file.export')}</div>
        {(['ifc', 'xlsx', 'csv', 'pdf', 'dxf'] as const).map((f) => (
          <button key={f} disabled title={prep}>
            <Download size={16} /> {t(`file.exportFormat.${f}`)}
          </button>
        ))}
        <div className="bs-sep" />
        <button onClick={run(() => setDialog('projectInfo'))} disabled={!project}>
          <Info size={16} /> {t('file.projectInfo')}
        </button>
        <button onClick={run(() => setDialog('settings'))} disabled={!project}>
          <Settings size={16} /> {t('file.settings')}
        </button>
        <div className="bs-sep" />
        <button onClick={run(closeProject)} disabled={!project}>
          {t('file.close')}
        </button>
      </nav>
      <div className="bs-main">
        <h2>{project ? project.name : t('common:appName')}</h2>
        {project && (
          <dl className="bs-info">
            <dt>{t('info.address')}</dt>
            <dd>{project.info.address ?? '—'}</dd>
            <dt>{t('settings.profile')}</dt>
            <dd>{t(`settings.profiles.${project.settings.profile}`)}</dd>
            <dt>{t('info.crs')}</dt>
            <dd>{project.geo.crs}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

function SiteTab() {
  const { t } = useTranslation('shell');
  const radius = useUiStore((s) => s.contextRadius);
  const setRadius = useUiStore((s) => s.setContextRadius);
  const busy = useShellStore((s) => s.busy);
  const setDialog = useShellStore((s) => s.setDialog);
  return (
    <>
      <Panel title={t('ribbon.panel.site')}>
        <LargeButton icon={LandPlot} label={t('ribbon.newSite')} onClick={newProject} />
        <Stack>
          <SmallButton icon={SquareDashed} label={t('ribbon.drawSite')} disabled />
          <SmallButton icon={Download} label={t('ribbon.importSite')} disabled />
        </Stack>
      </Panel>
      <Panel title={t('ribbon.panel.context')}>
        <LargeButton
          icon={RefreshCw}
          label={t('ribbon.reloadContext')}
          onClick={busy ? undefined : () => void reloadContext()}
          disabled={busy}
          title={busy ? t('ribbon.loading') : undefined}
        />
        <Stack>
          <label className="rb-field">
            <span>{t('ribbon.contextRadius')}</span>
            <NumField
              value={radius}
              onCommit={setRadius}
              digits={0}
              min={25}
              max={1000}
              suffix="m"
            />
          </label>
          <SmallButton icon={Box} label={t('ribbon.drawContext')} disabled />
        </Stack>
      </Panel>
      <Panel title={t('ribbon.panel.rules')}>
        <LargeButton
          icon={Scale}
          label={t('ribbon.constraints')}
          onClick={() => setDialog('constraints')}
        />
        <Stack>
          <SmallButton icon={Frame} label={t('ribbon.buildable')} disabled />
          <SmallButton icon={ScanLine} label={t('ribbon.buildingLines')} disabled />
        </Stack>
      </Panel>
    </>
  );
}

const GALLERY: { kind: TypologyKind; icon: LucideIcon }[] = [
  { kind: 'solitaer', icon: Box },
  { kind: 'zeile', icon: Rows3 },
  { kind: 'reihe', icon: Columns3 },
  { kind: 'freeLine', icon: Spline },
  { kind: 'freePolygon', icon: Pentagon },
];
const TEMPLATE_LIST: { id: TemplateId; icon: LucideIcon }[] = [
  { id: 'winkel', icon: AlignStartVertical },
  { id: 'uForm', icon: LayoutGrid },
  { id: 'blockrand', icon: SquareDashed },
  { id: 'hofhaus', icon: House },
];

function VolumeTab() {
  const { t } = useTranslation('shell');
  const tool = useUiStore((s) => s.tool);
  const placeOk = isToolImplemented('place');
  const isActive = (kind: TypologyKind, template?: TemplateId) =>
    tool.kind === 'place' && tool.typologyKind === kind && tool.template === template;
  return (
    <>
      <Panel title={t('ribbon.panel.typologies')}>
        {GALLERY.map((g) => (
          <LargeButton
            key={g.kind}
            icon={g.icon}
            label={t(`common:typology.${g.kind}`)}
            onClick={() => activateTool(placeTool(g.kind))}
            disabled={!placeOk}
            active={isActive(g.kind)}
          />
        ))}
      </Panel>
      <Panel title={t('ribbon.panel.templates')}>
        <div className="rb-grid2">
          {TEMPLATE_LIST.map((g) => (
            <SmallButton
              key={g.id}
              icon={g.icon}
              label={t(`common:template.${g.id}`)}
              onClick={() => activateTool(placeTool('freeLine', g.id))}
              disabled={!placeOk}
              active={isActive('freeLine', g.id)}
            />
          ))}
        </div>
      </Panel>
      <Panel title={t('ribbon.panel.variants')}>
        <LargeButton icon={GitBranch} label={t('ribbon.variants')} disabled />
      </Panel>
    </>
  );
}

const MODIFY: { tool: ToolState; icon: LucideIcon; code: string }[] = [
  { tool: { kind: 'move' }, icon: Move, code: 'MV' },
  { tool: { kind: 'rotate' }, icon: RotateCw, code: 'RO' },
  { tool: { kind: 'copy' }, icon: Copy, code: 'CO' },
  { tool: { kind: 'mirror' }, icon: SquareSplitHorizontal, code: 'MM' },
  { tool: { kind: 'array', count: 3 }, icon: Grid3x3, code: 'AR' },
  { tool: { kind: 'align' }, icon: AlignStartVertical, code: 'AL' },
];

function ModifyTab({ contextual }: { contextual?: boolean }) {
  const { t } = useTranslation('shell');
  const selection = useUiStore((s) => s.selection);
  const tool = useUiStore((s) => s.tool);
  return (
    <>
      <Panel title={t('ribbon.panel.modify')}>
        <div className="rb-grid3">
          {MODIFY.map((m) => (
            <SmallButton
              key={m.code}
              icon={m.icon}
              label={t(`ribbon.tool.${m.tool.kind}`)}
              shortcut={m.code}
              onClick={() => activateTool(m.tool)}
              disabled={!isToolImplemented(m.tool.kind)}
              active={tool.kind === m.tool.kind}
            />
          ))}
        </div>
      </Panel>
      <Panel title={t('ribbon.panel.delete')}>
        <LargeButton
          icon={Trash}
          label={t('common:actions.delete')}
          shortcut="DE"
          onClick={deleteSelection}
          disabled={!selection.length}
          title={selection.length ? undefined : t('ribbon.selectFirst')}
        />
      </Panel>
      {contextual && (
        <Panel title={t('ribbon.panel.selection')}>
          <div className="rb-note">{t('ribbon.selected', { count: selection.length })}</div>
        </Panel>
      )}
    </>
  );
}

const STYLES: VisualStyle[] = [
  'wireframe',
  'hiddenLine',
  'shaded',
  'consistentColors',
  'realistic',
];

function ViewTab() {
  const { t } = useTranslation('shell');
  const project = useProjectStore((s) => s.project);
  const style = useUiStore((s) => s.visualStyle);
  const setStyle = useUiStore((s) => s.setVisualStyle);
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const openView = useUiStore((s) => s.openView);
  return (
    <>
      <Panel title={t('ribbon.panel.views')}>
        <LargeButton
          icon={Cuboid}
          label={t('views.3d')}
          onClick={() => openView('3d')}
          disabled={!project}
          title={project ? undefined : t('ribbon.noProject')}
        />
        <Stack>
          <SmallButton icon={Frame} label={t('views.site')} disabled />
          <SmallButton icon={Columns3} label={t('views.elevations')} disabled />
          <SmallButton icon={ScanLine} label={t('views.sections')} disabled />
        </Stack>
        <Stack>
          <SmallButton icon={Box} label={t('views.axo')} disabled />
        </Stack>
      </Panel>
      <Panel title={t('ribbon.panel.navigate')}>
        <LargeButton
          icon={Maximize}
          label={t('ribbon.zoomExtents')}
          shortcut="ZF"
          onClick={zoomExtents}
          disabled={!project}
          title={project ? undefined : t('ribbon.noProject')}
        />
      </Panel>
      <Panel title={t('ribbon.panel.graphics')}>
        <Stack>
          <label className="rb-field">
            <span>{t('view.style')}</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as VisualStyle)}>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(`view.styles.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="rb-field">
            <span>{t('view.projection')}</span>
            <select
              value={projection}
              onChange={(e) => setProjection(e.target.value as 'perspective' | 'orthographic')}
            >
              <option value="perspective">{t('view.perspective')}</option>
              <option value="orthographic">{t('view.orthographic')}</option>
            </select>
          </label>
        </Stack>
      </Panel>
    </>
  );
}

function AnalysisTab() {
  const { t } = useTranslation('shell');
  const setDialog = useShellStore((s) => s.setDialog);
  return (
    <>
      <Panel title={t('ribbon.panel.tables')}>
        <LargeButton icon={Table} label={t('ribbon.areaTable')} disabled />
        <Stack>
          <SmallButton icon={FileText} label={t('ribbon.kpis')} disabled />
          <SmallButton icon={LayoutGrid} label={t('ribbon.unitMix')} disabled />
          <SmallButton icon={GitBranch} label={t('ribbon.variantCompare')} disabled />
        </Stack>
      </Panel>
      <Panel title={t('ribbon.panel.checks')}>
        <LargeButton
          icon={TriangleExclamationPoint}
          label={t('ribbon.warnings')}
          onClick={() => setDialog('warnings')}
        />
      </Panel>
    </>
  );
}

function OutputTab() {
  const { t } = useTranslation('shell');
  return (
    <Panel title={t('ribbon.panel.output')}>
      <LargeButton icon={FileText} label={t('ribbon.dossier')} disabled />
      <Stack>
        <SmallButton icon={Download} label="PDF" disabled />
        <SmallButton icon={Table} label="XLSX / CSV" disabled />
        <SmallButton icon={Box} label="IFC" disabled />
      </Stack>
    </Panel>
  );
}

function ArchicadTab() {
  const { t } = useTranslation('shell');
  return (
    <Panel title={t('ribbon.panel.archicad')}>
      <LargeButton icon={Plug} label={t('ribbon.connect')} disabled />
      <Stack>
        <SmallButton icon={Link} label={t('ribbon.transfer')} disabled />
        <SmallButton icon={RefreshCw} label={t('ribbon.update')} disabled />
        <SmallButton icon={Download} label={t('ribbon.exportScript')} disabled />
      </Stack>
    </Panel>
  );
}
