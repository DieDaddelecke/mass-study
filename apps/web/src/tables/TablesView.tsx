import { allSchedules, type Schedule, type ScheduleColumn, type ScheduleRow } from '@kubatur/core';
import { ChevronRight, ClipboardCopy, FileDown, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysis } from '../store/useAnalysis';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { cellText, columnHeader } from './format';
import {
  copyActiveTsv,
  exportActiveCsv,
  exportAllXlsx,
  SCHEDULE_TABS,
  useTablesStore,
} from './tablesStore';
import './tables.css';

/** Schedule workspace (SPEC §8.6): surfaces, KPIs, typologies & mix, variant comparison. */
export function TablesView() {
  const { t, i18n } = useTranslation('tables');
  const project = useProjectStore((s) => s.project);
  const analysis = useAnalysis();
  const tab = useTablesStore((s) => s.tab);
  const setTab = useTablesStore((s) => s.setTab);

  const schedules = useMemo(() => {
    if (!project) return [];
    const analyses = analysis ? new Map([[project.activeVariantId, analysis]]) : undefined;
    try {
      return allSchedules(project, analyses ? { analyses } : {});
    } catch (e) {
      console.error('schedules failed', e);
      return [];
    }
  }, [project, analysis]);
  const schedule = schedules.find((s) => s.id === tab) ?? schedules[0];
  const variantName = project?.variants.find((v) => v.id === project.activeVariantId)?.name ?? '';

  return (
    <div className="tables-view">
      <section className="glass tables-card" aria-label={t('title')}>
        <header className="tables-head">
          <div className="tables-title">
            <h2>{t('title')}</h2>
            <span className="tables-sub">
              {tab === 'comparison'
                ? t('allVariants', { count: project?.variants.length ?? 0 })
                : variantName}
              {' · '}
              {t(`profile.${project?.settings.profile ?? 'FR'}`)}
            </span>
          </div>
          <div className="tabs tables-tabs" role="tablist">
            {SCHEDULE_TABS.map((id) => (
              <button
                key={id}
                role="tab"
                className="tab"
                aria-selected={tab === id}
                data-state={tab === id ? 'active' : 'inactive'}
                onClick={() => setTab(id)}
              >
                {t(`tab.${id}`)}
              </button>
            ))}
          </div>
          <div className="tables-actions">
            <button
              className="btn btn-sm btn-ghost"
              disabled={!schedule}
              onClick={() => schedule && void copyActiveTsv(schedule)}
              title={t('actions.copyHint')}
            >
              <ClipboardCopy size={15} strokeWidth={1.75} />
              {t('actions.copy')}
            </button>
            <button
              className="btn btn-sm"
              disabled={!schedule}
              onClick={() => schedule && exportActiveCsv(schedule)}
            >
              <FileDown size={15} strokeWidth={1.75} />
              CSV
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={!schedules.length}
              onClick={() => void exportAllXlsx(schedules)}
              title={t('actions.xlsxHint')}
            >
              <FileSpreadsheet size={15} strokeWidth={1.75} />
              Excel
            </button>
          </div>
        </header>
        {schedule ? (
          <ScheduleTable key={`${schedule.id}-${i18n.language}`} schedule={schedule} />
        ) : (
          <div className="tables-empty">{t('empty')}</div>
        )}
      </section>
    </div>
  );
}

function isNumeric(col: ScheduleColumn): boolean {
  const f = col.format;
  return f !== 'text' && f !== 'bool';
}

function ScheduleTable({ schedule }: { schedule: Schedule }) {
  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const { rows, columns } = schedule;

  // A collapsed group hides the following rows that are nested deeper than the group.
  const hidden = useMemo(() => {
    const out = new Set<number>();
    for (const g of collapsed) {
      const d = rows[g]!.depth;
      for (let i = g + 1; i < rows.length && rows[i]!.depth > d; i++) out.add(i);
    }
    return out;
  }, [collapsed, rows]);

  const toggle = (i: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const select = (r: ScheduleRow) => {
    if (r.massId) useUiStore.getState().setSelection([r.massId]);
  };

  return (
    <div className="tables-scroll">
      <table className={`sched sched-${schedule.id}`}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: `${(c.width ?? 12) * 7}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c, ci) => (
              <th key={c.key} className={ci > 0 && c.format !== 'text' ? 'num' : undefined}>
                {columnHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (hidden.has(i)) return null;
            const selected = !!r.massId && selection.includes(r.massId);
            const cls = [
              `k-${r.kind}`,
              `d-${r.depth}`,
              r.massId ? 'is-mass' : '',
              selected ? 'is-selected' : '',
              r.massId && hover === r.massId ? 'is-hover' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr
                key={i}
                className={cls}
                onClick={() => select(r)}
                onMouseEnter={
                  r.massId ? () => useUiStore.getState().setHover(r.massId!) : undefined
                }
                onMouseLeave={r.massId ? () => useUiStore.getState().setHover(null) : undefined}
              >
                {columns.map((c, ci) => {
                  const txt = cellText(c, r);
                  if (ci === 0) {
                    return (
                      <td key={c.key} className="name" style={{ paddingLeft: 30 + r.depth * 16 }}>
                        {r.kind === 'group' ? (
                          <button
                            className="sched-toggle"
                            aria-expanded={!collapsed.has(i)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(i);
                            }}
                          >
                            <ChevronRight size={13} strokeWidth={2} />
                          </button>
                        ) : null}
                        <span>{txt}</span>
                      </td>
                    );
                  }
                  if (c.key === 'status' && r.status && r.status !== 'none' && txt) {
                    return (
                      <td key={c.key}>
                        <span className={`sched-pill s-${r.status}`}>{txt}</span>
                      </td>
                    );
                  }
                  if (c.format === 'bool') {
                    return (
                      <td key={c.key} className="center">
                        {txt && (
                          <span
                            className={r.cells[c.key] ? 'sched-dot on' : 'sched-dot'}
                            title={txt}
                          />
                        )}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.key}
                      className={isNumeric(c) ? 'num' : c.key === 'status' ? 'muted' : undefined}
                    >
                      {txt}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
