import { allSchedules, type Schedule, type ScheduleId } from '@kubatur/core';
import { create } from 'zustand';
import i18n from '../i18n';
import { copyTsv, exportCsv } from '../exports/csv';
import { exportXlsx } from '../exports/xlsx';
import { useShellStore } from '../shell/shellStore';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

export const SCHEDULE_TABS: readonly ScheduleId[] = [
  'surfaces',
  'kpis',
  'typologies',
  'calculation',
  'comparison',
];

interface TablesState {
  tab: ScheduleId;
  setTab: (tab: ScheduleId) => void;
}

/** Active schedule tab (UI only, not part of the document). */
export const useTablesStore = create<TablesState>()((set) => ({
  tab: 'surfaces',
  setTab: (tab) => set({ tab }),
}));

/** Open the schedule workspace on a given tab. */
export function openSchedule(tab: ScheduleId): void {
  useTablesStore.getState().setTab(tab);
  useUiStore.getState().openView('areas');
}

function current(): { schedules: Schedule[]; name: string } | null {
  const project = useProjectStore.getState().project;
  if (!project) return null;
  return { schedules: allSchedules(project), name: project.name };
}

const fail = (e: unknown) => {
  console.error(e);
  useShellStore.getState().setError(i18n.t('tables:export.failed'));
};

export async function exportAllXlsx(schedules?: Schedule[]): Promise<void> {
  const c = current();
  if (!c) return;
  const shell = useShellStore.getState();
  shell.setBusy(true);
  try {
    await exportXlsx(schedules ?? c.schedules, c.name);
    shell.setInfo(i18n.t('tables:export.xlsxDone'));
  } catch (e) {
    fail(e);
  } finally {
    shell.setBusy(false);
  }
}

/** CSV of the active tab (CSV has no sheets). */
export function exportActiveCsv(schedule?: Schedule): void {
  const c = current();
  if (!c) return;
  const tab = useTablesStore.getState().tab;
  const s = schedule ?? c.schedules.find((x) => x.id === tab) ?? c.schedules[0]!;
  try {
    exportCsv(s, c.name);
  } catch (e) {
    fail(e);
  }
}

// `?schedule=surfaces|kpis|typologies|calculation|comparison` opens the schedule workspace (screenshots, links).
if (typeof window !== 'undefined') {
  const s = new URLSearchParams(window.location.search).get('schedule');
  if (s && (SCHEDULE_TABS as readonly string[]).includes(s)) openSchedule(s as ScheduleId);
}

export async function copyActiveTsv(schedule: Schedule): Promise<void> {
  try {
    await copyTsv(schedule);
    useShellStore.getState().setInfo(i18n.t('tables:export.copied'));
  } catch (e) {
    fail(e);
  }
}
