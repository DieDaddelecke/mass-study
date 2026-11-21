import type { ConstraintRow } from '@kubatur/core';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useShellStore } from './shellStore';
import { TrafficDot, type TrafficStatus } from './ui';

interface Kpi {
  key: string;
  label: string;
  value: string;
  status?: TrafficStatus;
  title?: string;
  /** 0…1+ share of the constraint, shown as a thin progress bar. */
  progress?: number;
}

export function KpiBar() {
  const { t, i18n } = useTranslation('shell');
  const profile = useProjectStore((s) => s.project?.settings.profile);
  const analysis = useAnalysis();
  const setDialog = useShellStore((s) => s.setDialog);
  if (!analysis || !profile) return null;
  const lng = i18n.language;
  const n = (v: number, d = 2) => formatNumber(v, d, lng);
  const row = (key: string): ConstraintRow | undefined =>
    analysis.constraints.find((r) => r.key === key);
  const st = (key: string): Pick<Kpi, 'status' | 'title' | 'progress'> => {
    const r = row(key);
    if (!r) return {};
    return {
      status: r.status,
      progress: r.target ? r.actual / r.target : undefined,
      title:
        r.target !== undefined
          ? t('kpi.target', { status: t(`common:status.${r.status}`), target: n(r.target) })
          : t('common:status.none'),
    };
  };
  let kpis: Kpi[];
  if (profile === 'FR') {
    const fr = analysis.fr;
    kpis = [
      { key: 'emprise', label: t('common:kpi.emprise'), value: `${n(fr.emprise, 0)} m²` },
      { key: 'ces', label: t('common:kpi.ces'), value: `${n(fr.ces * 100, 1)} %`, ...st('ces') },
      {
        key: 'sdp',
        label: t('common:kpi.surfaceDePlancher'),
        value: `${n(fr.surfaceDePlancher, 0)} m²`,
        ...st('surfaceDePlancher'),
      },
      {
        key: 'hauteur',
        label: t('common:kpi.hauteur'),
        value: `${n(fr.hauteurEgout)} / ${n(fr.hauteurAcrotere)} m`,
        ...st('hauteur'),
        title: `${t('common:kpi.hauteurEgout')} / ${t('common:kpi.hauteurAcrotere')}`,
      },
      {
        key: 'niveaux',
        label: t('common:kpi.niveaux'),
        value: fr.formula || `${fr.niveaux}`,
        ...st('niveaux'),
      },
      { key: 'logements', label: t('common:kpi.logements'), value: `${fr.logements}` },
      {
        key: 'surfaceHabitable',
        label: t('common:kpi.surfaceHabitable'),
        value: `${n(fr.surfaceHabitable, 0)} m²`,
      },
    ];
    const g = analysis.green;
    if (g.espacesVerts > 0 || row('pleineTerre')?.target !== undefined)
      kpis.push({
        key: 'pleineTerre',
        label: t('common:kpi.pleineTerre'),
        value: `${n(g.pleineTerreRatio * 100, 0)} %`,
        ...st('pleineTerre'),
        title: `${t('common:kpi.pleineTerre')} ${n(g.pleineTerre, 0)} m² · ${t('common:kpi.espacesVerts')} ${n(g.espacesVerts, 0)} m² (${n(g.espacesVertsRatio * 100, 0)} %)`,
      });
  } else {
    const de = analysis.de;
    kpis = [
      { key: 'grz', label: t('common:kpi.grz'), value: n(de.grz), ...st('grz') },
      { key: 'gfz', label: t('common:kpi.gfz'), value: n(de.gfz), ...st('gfz') },
      { key: 'bmz', label: t('common:kpi.bmz'), value: n(de.bmz), ...st('bmz') },
      {
        key: 'height',
        label: t('common:kpi.totalHeight'),
        value: `${n(de.totalHeight)} m`,
        ...st('totalHeight'),
      },
      {
        key: 'vg',
        label: t('common:kpi.maxFullStoreys'),
        value: `${de.maxFullStoreys}`,
        ...st('maxFullStoreys'),
      },
      { key: 'we', label: t('common:kpi.logements'), value: `${de.dwellings}` },
      { key: 'bgf', label: t('common:kpi.bgf'), value: `${n(analysis.result.areas.bgf, 0)} m²` },
    ];
  }
  return (
    <div className="glass kpibar" role="group" aria-label={t('kpi.title')}>
      {kpis.map((k) => (
        <button
          type="button"
          key={k.key}
          className="kpi"
          data-kpi={k.key}
          title={k.title ?? t('kpi.open')}
          onClick={() => setDialog('constraints')}
        >
          <span className="kpi-label">
            {k.label}
            {k.status && k.status !== 'none' && <TrafficDot status={k.status} title={k.title} />}
          </span>
          <span className="kpi-value">{k.value}</span>
          {k.progress !== undefined && (
            <span className={`kpi-bar kpi-bar-${k.status ?? 'none'}`} aria-hidden>
              <span style={{ width: `${Math.min(100, k.progress * 100)}%` }} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Small pill with the number of warnings; opens the warnings dialog. */
export function WarningsPill() {
  const { t } = useTranslation('shell');
  const analysis = useAnalysis();
  const setDialog = useShellStore((s) => s.setDialog);
  if (!analysis) return null;
  const warnings = analysis.warnings;
  const errors = warnings.filter((w) => w.severity === 'error').length;
  const cls = errors ? 'is-error' : warnings.length ? 'is-warning' : 'is-ok';
  return (
    <button
      type="button"
      className={`glass warn-pill ${cls}`}
      title={t('status.warningsTitle')}
      aria-label={`${t('status.warningsTitle')} : ${warnings.length}`}
      onClick={() => setDialog('warnings')}
    >
      {warnings.length ? (
        <TriangleAlert size={15} strokeWidth={1.75} />
      ) : (
        <CircleCheck size={15} strokeWidth={1.75} />
      )}
      <span className="num">{warnings.length}</span>
    </button>
  );
}
