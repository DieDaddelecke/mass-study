import type { TemplateId, TypologyKind } from '@kubatur/core';
import {
  AlignStartVertical,
  Box,
  Columns3,
  Copy,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  Frame,
  GitBranch,
  Grid3x3,
  House,
  Info,
  LandPlot,
  LayoutGrid,
  Link,
  Maximize,
  Monitor,
  Moon,
  MousePointer2,
  Move,
  Palette,
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
  Sun,
  Table,
  Trash,
  TriangleAlert,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import i18n from '../i18n';
import { useArchicadStore } from '../archicad/archicadStore';
import { useProjectStore } from '../store/projectStore';
import type { ToolState, VisualStyle } from '../store/tools';
import { useUiStore } from '../store/uiStore';
import { useThemeStore } from '../theme/themeStore';
import { useViewportStore } from '../viewport/viewportStore';
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
import { useShellStore } from './shellStore';
import { exportActiveCsv, exportAllXlsx, openSchedule } from '../tables/tablesStore';

export type CommandGroup =
  | 'file'
  | 'edit'
  | 'volume'
  | 'modify'
  | 'site'
  | 'view'
  | 'analysis'
  | 'output'
  | 'archicad'
  | 'theme';

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  enabled: boolean;
  /** Tooltip for disabled commands ("en préparation" unless another reason applies). */
  reason?: string;
  active?: boolean;
  run: () => void;
}

export const TYPOLOGIES: { kind: TypologyKind; icon: LucideIcon }[] = [
  { kind: 'solitaer', icon: Box },
  { kind: 'zeile', icon: Rows3 },
  { kind: 'reihe', icon: Columns3 },
  { kind: 'freeLine', icon: Spline },
  { kind: 'freePolygon', icon: Pentagon },
];

export const TEMPLATE_LIST: { id: TemplateId; icon: LucideIcon }[] = [
  { id: 'winkel', icon: AlignStartVertical },
  { id: 'uForm', icon: LayoutGrid },
  { id: 'blockrand', icon: SquareDashed },
  { id: 'hofhaus', icon: House },
];

export const MODIFY_TOOLS: { tool: ToolState; icon: LucideIcon; code: string }[] = [
  { tool: { kind: 'move' }, icon: Move, code: 'MV' },
  { tool: { kind: 'rotate' }, icon: RotateCw, code: 'RO' },
  { tool: { kind: 'copy' }, icon: Copy, code: 'CO' },
  { tool: { kind: 'mirror' }, icon: SquareSplitHorizontal, code: 'MM' },
  { tool: { kind: 'array', count: 3 }, icon: Grid3x3, code: 'AR' },
  { tool: { kind: 'align' }, icon: AlignStartVertical, code: 'AL' },
];

export const STYLES: VisualStyle[] = [
  'wireframe',
  'hiddenLine',
  'shaded',
  'consistentColors',
  'granulometry',
  'realistic',
];

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, { ns: 'shell', ...o });

/** Every command of the application, with its current enabled state (for the palette). */
export function getCommands(): Command[] {
  const hasProject = useProjectStore.getState().project !== null;
  const ui = useUiStore.getState();
  const shell = useShellStore.getState();
  const prep = i18n.t('common:inPreparation');
  const noProject = t('ribbon.noProject');
  const tool = ui.tool;
  const placeOk = hasProject && isToolImplemented('place');
  const off = (id: string, group: CommandGroup, label: string, icon: LucideIcon): Command => ({
    id,
    group,
    label,
    icon,
    enabled: false,
    reason: prep,
    run: () => undefined,
  });
  const proj = (c: Omit<Command, 'enabled'> & { enabled?: boolean }): Command => ({
    ...c,
    enabled: hasProject && (c.enabled ?? true),
    reason: hasProject ? c.reason : noProject,
  });

  const cmds: Command[] = [
    {
      id: 'file.new',
      group: 'file',
      label: t('file.new'),
      icon: FilePlus,
      enabled: true,
      run: newProject,
    },
    {
      id: 'file.open',
      group: 'file',
      label: t('file.open'),
      icon: FolderOpen,
      enabled: true,
      run: () => void openFromFile(),
    },
    proj({
      id: 'file.save',
      group: 'file',
      label: t('file.save'),
      icon: Save,
      shortcut: 'Ctrl+S',
      run: save,
    }),
    proj({ id: 'file.saveAs', group: 'file', label: t('file.saveAs'), icon: SaveAll, run: saveAs }),
    proj({
      id: 'file.info',
      group: 'file',
      label: t('file.projectInfo'),
      icon: Info,
      run: () => shell.setDialog('projectInfo'),
    }),
    proj({
      id: 'file.settings',
      group: 'file',
      label: t('file.settings'),
      icon: Settings,
      run: () => shell.setDialog('settings'),
    }),
    proj({ id: 'file.close', group: 'file', label: t('file.close'), icon: X, run: closeProject }),
    proj({
      id: 'edit.undo',
      group: 'edit',
      label: t('cmd.undo'),
      icon: Undo2,
      shortcut: 'Ctrl+Z',
      run: undo,
    }),
    proj({
      id: 'edit.redo',
      group: 'edit',
      label: t('cmd.redo'),
      icon: Redo2,
      shortcut: 'Ctrl+Y',
      run: redo,
    }),
    proj({
      id: 'edit.delete',
      group: 'edit',
      label: i18n.t('common:actions.delete'),
      icon: Trash,
      shortcut: 'DE',
      enabled: ui.selection.length > 0,
      reason: ui.selection.length ? undefined : t('ribbon.selectFirst'),
      run: deleteSelection,
    }),
    proj({
      id: 'tool.select',
      group: 'modify',
      label: t('cmd.select'),
      icon: MousePointer2,
      shortcut: 'Esc',
      active: tool.kind === 'select',
      run: () => activateTool({ kind: 'select' }),
    }),
  ];
  for (const g of TYPOLOGIES)
    cmds.push({
      id: `place.${g.kind}`,
      group: 'volume',
      label: t('options.place', { name: i18n.t(`common:typology.${g.kind}`) }),
      icon: g.icon,
      enabled: placeOk,
      reason: hasProject ? prep : noProject,
      active: tool.kind === 'place' && tool.typologyKind === g.kind && !tool.template,
      run: () => activateTool(placeTool(g.kind)),
    });
  for (const g of TEMPLATE_LIST)
    cmds.push({
      id: `template.${g.id}`,
      group: 'volume',
      label: t('options.place', { name: i18n.t(`common:template.${g.id}`) }),
      icon: g.icon,
      enabled: placeOk,
      reason: hasProject ? prep : noProject,
      active: tool.kind === 'place' && tool.template === g.id,
      run: () => activateTool(placeTool('freeLine', g.id)),
    });
  cmds.push(off('volume.variants', 'volume', t('ribbon.variants'), GitBranch));
  for (const m of MODIFY_TOOLS) {
    const ok = isToolImplemented(m.tool.kind);
    cmds.push({
      id: `tool.${m.tool.kind}`,
      group: 'modify',
      label: t(`ribbon.tool.${m.tool.kind}`),
      icon: m.icon,
      shortcut: m.code,
      enabled: hasProject && ok,
      reason: ok ? (hasProject ? undefined : noProject) : prep,
      active: tool.kind === m.tool.kind,
      run: () => activateTool(m.tool),
    });
  }
  cmds.push(
    {
      id: 'site.new',
      group: 'site',
      label: t('ribbon.newSite'),
      icon: LandPlot,
      enabled: true,
      run: newProject,
    },
    off('site.draw', 'site', t('ribbon.drawSite'), SquareDashed),
    off('site.import', 'site', t('ribbon.importSite'), Download),
    proj({
      id: 'site.reload',
      group: 'site',
      label: t('ribbon.reloadContext'),
      icon: RefreshCw,
      enabled: !shell.busy,
      run: () => void reloadContext(),
    }),
    off('site.drawContext', 'site', t('ribbon.drawContext'), Box),
    proj({
      id: 'site.rules',
      group: 'site',
      label: t('ribbon.constraints'),
      icon: Scale,
      run: () => shell.setDialog('constraints'),
    }),
    off('site.buildable', 'site', t('ribbon.buildable'), Frame),
    off('site.lines', 'site', t('ribbon.buildingLines'), ScanLine),
    proj({
      id: 'view.zoomExtents',
      group: 'view',
      label: t('ribbon.zoomExtents'),
      icon: Maximize,
      shortcut: 'ZF',
      run: zoomExtents,
    }),
    proj({
      id: 'view.home',
      group: 'view',
      label: i18n.t('viewport:cube.home'),
      icon: House,
      run: () => useViewportStore.getState().requestHome(),
    }),
    proj({
      id: 'view.projection',
      group: 'view',
      label:
        ui.projection === 'perspective'
          ? i18n.t('viewport:bar.toOrtho')
          : i18n.t('viewport:bar.toPersp'),
      icon: Box,
      run: () => ui.setProjection(ui.projection === 'perspective' ? 'orthographic' : 'perspective'),
    }),
  );
  for (const s of STYLES)
    cmds.push(
      proj({
        id: `view.style.${s}`,
        group: 'view',
        label: `${t('view.style')} : ${t(`view.styles.${s}`)}`,
        icon: Palette,
        active: ui.visualStyle === s,
        run: () => ui.setVisualStyle(s),
      }),
    );
  cmds.push(
    proj({
      id: 'analysis.warnings',
      group: 'analysis',
      label: t('ribbon.warnings'),
      icon: TriangleAlert,
      run: () => shell.setDialog('warnings'),
    }),
    off('analysis.areaTable', 'analysis', t('ribbon.areaTable'), Table),
    off('analysis.kpis', 'analysis', t('ribbon.kpis'), FileText),
    off('analysis.unitMix', 'analysis', t('ribbon.unitMix'), LayoutGrid),
    off('analysis.compare', 'analysis', t('ribbon.variantCompare'), GitBranch),
    off('output.dossier', 'output', t('ribbon.dossier'), FileText),
  );
  cmds.push(
    proj({
      id: 'output.ifc',
      group: 'output',
      label: `${t('file.export')} ${t('file.exportFormat.ifc')}`,
      icon: Download,
      run: () => shell.setDialog('ifcExport'),
    }),
  );
  for (const f of ['xlsx', 'csv', 'pdf', 'dxf'] as const)
    cmds.push(
      off(`output.${f}`, 'output', `${t('file.export')} ${t(`file.exportFormat.${f}`)}`, Download),
    );
  cmds.push(
    ...(
      [
        ['archicad.connect', 'ribbon.connect', Plug],
        ['archicad.transfer', 'ribbon.transfer', Link],
        ['archicad.update', 'ribbon.update', RefreshCw],
      ] as const
    ).map(([id, key, icon]) =>
      proj({
        id,
        group: 'archicad',
        label: `Archicad : ${t(key)}`,
        icon,
        run: () => useArchicadStore.getState().openDialog(),
      }),
    ),
    off('archicad.script', 'archicad', `Archicad : ${t('ribbon.exportScript')}`, Download),
  );
  const theme = useThemeStore.getState();
  for (const [p, icon] of [
    ['light', Sun],
    ['dark', Moon],
    ['system', Monitor],
  ] as const)
    cmds.push({
      id: `theme.${p}`,
      group: 'theme',
      label: `${t('theme.label')} : ${t(`theme.${p}`)}`,
      icon,
      enabled: true,
      active: theme.preference === p,
      run: () => theme.setPreference(p),
    });
  // Schedules and XLSX/CSV export (tables/*): replace the "en préparation" placeholders in place.
  for (const c of [
    proj({
      id: 'analysis.areaTable',
      group: 'analysis',
      label: t('ribbon.areaTable'),
      icon: Table,
      run: () => openSchedule('surfaces'),
    }),
    proj({
      id: 'analysis.kpis',
      group: 'analysis',
      label: t('ribbon.kpis'),
      icon: FileText,
      run: () => openSchedule('kpis'),
    }),
    proj({
      id: 'analysis.unitMix',
      group: 'analysis',
      label: t('ribbon.unitMix'),
      icon: LayoutGrid,
      run: () => openSchedule('typologies'),
    }),
    proj({
      id: 'analysis.compare',
      group: 'analysis',
      label: t('ribbon.variantCompare'),
      icon: GitBranch,
      run: () => openSchedule('comparison'),
    }),
    proj({
      id: 'output.xlsx',
      group: 'output',
      label: i18n.t('tables:export.xlsx'),
      icon: Download,
      run: () => void exportAllXlsx(),
    }),
    proj({
      id: 'output.csv',
      group: 'output',
      label: i18n.t('tables:export.csv'),
      icon: Download,
      run: () => exportActiveCsv(),
    }),
    proj({
      id: 'output.dossier',
      group: 'output',
      label: t('ribbon.dossier'),
      icon: FileText,
      run: () => shell.setDialog('dossier'),
    }),
    proj({
      id: 'output.pdf',
      group: 'output',
      label: i18n.t('dossier:title') + ' (PDF)',
      icon: Download,
      run: () => shell.setDialog('dossier'),
    }),
  ]) {
    const i = cmds.findIndex((x) => x.id === c.id);
    if (i >= 0) cmds[i] = c;
    else cmds.push(c);
  }
  return cmds;
}

/** Simple fuzzy score: all query characters must appear in order; contiguous runs score higher. */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const s = normalize(text);
  const idx = s.indexOf(q);
  if (idx >= 0) return 100 - idx;
  let score = 0;
  let pos = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = s.indexOf(ch, pos);
    if (i < 0) return 0;
    run = i === pos ? run + 1 : 0;
    score += 1 + run;
    pos = i + 1;
  }
  return score;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function filterCommands(cmds: Command[], query: string): Command[] {
  return cmds
    .map((c) => ({
      c,
      s: Math.max(
        fuzzyScore(query, c.label),
        c.shortcut && normalize(c.shortcut) === normalize(query.trim()) ? 200 : 0,
      ),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Number(b.c.enabled) - Number(a.c.enabled))
    .map((x) => x.c);
}
