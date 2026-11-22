import { defaultTypology, TEMPLATES, type TemplateId, type TypologyKind } from '@kubatur/core';
import i18n from '../i18n';
import { loadAllContextForProject } from '../newProject/loadContext';
import { downloadProject, pickFile, readProjectFile } from '../persistence/file';
import { loadRecent } from '../persistence/autosave';
import { actions, redo, undo, useProjectStore } from '../store/projectStore';
import type { ToolKind, ToolState } from '../store/tools';
import { useUiStore } from '../store/uiStore';
import { IMPLEMENTED_TOOLS } from '../viewport/tools/capabilities';
import { useViewportStore } from '../viewport/viewportStore';
import { useShellStore } from './shellStore';
import type { Project } from '@kubatur/core';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, { ns: 'shell', ...o });

export function isToolImplemented(kind: ToolKind): boolean {
  return IMPLEMENTED_TOOLS.includes(kind);
}

export function openProject(p: Project): void {
  useUiStore.getState().setSelection([]);
  useUiStore.getState().setTool({ kind: 'select' });
  useProjectStore.getState().load(p);
  const lng = p.settings.language;
  if (lng && lng !== i18n.language) void i18n.changeLanguage(lng);
}

export function closeProject(): void {
  useUiStore.getState().setSelection([]);
  useProjectStore.getState().load(null);
}

export function newProject(): void {
  useUiStore.getState().setNewProjectOpen(true);
}

export async function openFromFile(): Promise<void> {
  const file = await pickFile();
  if (!file) return;
  try {
    openProject(await readProjectFile(file));
  } catch (e) {
    useShellStore.getState().setError(t('errors.openFile', { message: (e as Error).message }));
  }
}

export async function openFromAutosave(id: string): Promise<void> {
  try {
    openProject(await loadRecent(id));
  } catch (e) {
    useShellStore.getState().setError(t('errors.openFile', { message: (e as Error).message }));
  }
}

export function save(): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  downloadProject(p);
  useShellStore.getState().setInfo(t('info.saved'));
}

export function saveAs(): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const name = window.prompt(t('file.saveAsPrompt'), p.name);
  if (name) downloadProject(p, name);
}

export async function reloadContext(): Promise<void> {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const shell = useShellStore.getState();
  shell.setBusy(true);
  try {
    const r = await loadAllContextForProject(p, useUiStore.getState().contextRadius);
    if (r.surroundings) actions.setSurroundings(r.surroundings);
    if (!r.buildings) throw r.buildingsError;
    actions.setContext(r.buildings);
    shell.setInfo(t('info.contextLoaded', { count: r.buildings.length }));
  } catch (e) {
    shell.setError(t('errors.context', { message: (e as Error).message }));
  } finally {
    shell.setBusy(false);
  }
}

export function placeTool(kind: TypologyKind, template?: TemplateId): ToolState {
  const typology = template ? TEMPLATES[template]() : defaultTypology(kind);
  const tool: ToolState = { kind: 'place', typologyKind: typology.kind, typology, usage: 'wohnen' };
  if (template) tool.template = template;
  return tool;
}

/** Set a tool if implemented; otherwise show a hint. Returns true if the tool was activated. */
export function activateTool(tool: ToolState): boolean {
  if (!isToolImplemented(tool.kind)) {
    useUiStore.getState().setHint(i18n.t('common:inPreparation'));
    return false;
  }
  useUiStore.getState().setTool(tool);
  return true;
}

export function deleteSelection(): void {
  const { selection, setSelection } = useUiStore.getState();
  const p = useProjectStore.getState().project;
  if (!p || !selection.length) return;
  actions.deleteMasses(selection);
  setSelection([]);
}

export function zoomExtents(): void {
  useViewportStore.getState().requestZoomExtents();
}

export function escape(): void {
  useUiStore.getState().setTool({ kind: 'select' });
}

export { undo, redo };

/** Switch between the two editable working views: 3D and the 2D plan (PL). */
export function togglePlan(): void {
  const ui = useUiStore.getState();
  ui.openView(ui.activeView === 'plan' ? '3d' : 'plan');
}

/** Two-letter command table (SPEC §9). */
export const TWO_LETTER: Record<string, () => void> = {
  MV: () => activateTool({ kind: 'move' }),
  RO: () => activateTool({ kind: 'rotate' }),
  CO: () => activateTool({ kind: 'copy' }),
  MM: () => activateTool({ kind: 'mirror' }),
  AR: () => activateTool({ kind: 'array', count: 3 }),
  AL: () => activateTool({ kind: 'align' }),
  DE: deleteSelection,
  ZF: zoomExtents,
  PL: togglePlan,
};
