import {
  defaultProgramme,
  programmeShares,
  resolveProgramme,
  type Mass,
  type MassLayout,
  type ProgrammeConfig,
  type ProgrammeResult,
  type Settings,
  type UnitType,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { Link2, Unlink2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useAnalysis } from '../store/useAnalysis';
import { Group, NumField, Row } from './ui';

const pct = (v: number) => `${formatNumber(v * 100, 0)} %`;

/** Merge entry `k` with the next one (« T1/T2 »). */
function merge(cfg: ProgrammeConfig, k: number): ProgrammeConfig {
  const a = cfg.entries[k];
  const b = cfg.entries[k + 1];
  if (!a || !b) return cfg;
  const entries = [...cfg.entries];
  entries.splice(k, 2, { typeIds: [...a.typeIds, ...b.typeIds], value: a.value + b.value });
  return { ...cfg, entries };
}

/** Split a group into one entry per type (the value shared evenly). */
function split(cfg: ProgrammeConfig, k: number): ProgrammeConfig {
  const e = cfg.entries[k];
  if (!e || e.typeIds.length < 2) return cfg;
  const v = Math.round((e.value / e.typeIds.length) * 10) / 10;
  const entries = [...cfg.entries];
  entries.splice(k, 1, ...e.typeIds.map((id) => ({ typeIds: [id], value: v })));
  return { ...cfg, entries };
}

/** Values as percent or as dwellings; switching keeps the shares (counts for `total`). */
function switchMode(cfg: ProgrammeConfig, mode: ProgrammeConfig['mode'], total: number) {
  if (mode === cfg.mode) return cfg;
  const sum = cfg.entries.reduce((s, e) => s + Math.max(0, e.value), 0) || 1;
  const scale = mode === 'percent' ? 100 / sum : Math.max(1, total) / sum;
  const digits = mode === 'percent' ? 10 : 1;
  return {
    ...cfg,
    mode,
    entries: cfg.entries.map((e) => ({
      ...e,
      value: Math.round(Math.max(0, e.value) * scale * digits) / digits,
    })),
  };
}

/**
 * Editor of a housing programme: on/off, percent or dwellings, one row per type or group
 * (neighbouring types can be grouped, « T1/T2 »), with the achieved mix when given.
 */
export function ProgrammeEditor({
  cfg,
  mix,
  onChange,
  result,
  label,
  absolute = false,
}: {
  cfg: ProgrammeConfig;
  mix: readonly UnitType[];
  onChange: (cfg: ProgrammeConfig) => void;
  result?: ProgrammeResult | undefined;
  label: string;
  /** Targets as entered (dwellings of the whole project), not scaled to the achieved total. */
  absolute?: boolean;
}) {
  const { t } = useTranslation('shell');
  const shares = programmeShares(cfg, mix);
  const sum = cfg.entries.reduce((s, e) => s + Math.max(0, e.value), 0);
  return (
    <div className="programme">
      <Row label={label}>
        <input
          type="checkbox"
          aria-label={label}
          checked={cfg.enabled}
          onChange={(e) => onChange({ ...cfg, enabled: e.target.checked })}
        />
      </Row>
      {cfg.enabled && (
        <>
          <Row label={t('programme.mode')}>
            <select
              aria-label={t('programme.mode')}
              value={cfg.mode}
              onChange={(e) =>
                onChange(
                  switchMode(cfg, e.target.value as ProgrammeConfig['mode'], result?.total ?? 0),
                )
              }
            >
              <option value="percent">{t('programme.percent')}</option>
              <option value="count">{t('programme.count')}</option>
            </select>
          </Row>
          <table className="programme-table">
            <thead>
              <tr>
                <th>{t('programme.type')}</th>
                <th className="num">{t('programme.target')}</th>
                <th className="num">{cfg.mode === 'count' ? '%' : ''}</th>
                {result && <th className="num">{t('programme.achieved')}</th>}
                {result && <th className="num">%</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {cfg.entries.map((e, k) => {
                const sh = shares.find((s) => s.typeIds.join() === e.typeIds.join());
                const r = result?.entries.find((x) => x.typeIds.join() === e.typeIds.join());
                const target = r ? (absolute && r.count !== undefined ? r.count : r.target) : 0;
                const off = r ? Math.abs(r.achieved - target) >= 1 : false;
                const name = e.typeIds
                  .map((id) => mix.find((u) => u.id === id)?.label ?? id)
                  .join('/');
                return (
                  <tr key={e.typeIds.join()}>
                    <td>
                      {name}
                      {e.typeIds.length > 1 && (
                        <button
                          className="icon-btn programme-link"
                          title={t('programme.split')}
                          aria-label={`${t('programme.split')} ${name}`}
                          onClick={() => onChange(split(cfg, k))}
                        >
                          <Unlink2 size={12} />
                        </button>
                      )}
                    </td>
                    <td className="num">
                      <NumField
                        ariaLabel={`${t('programme.target')} ${name}`}
                        value={e.value}
                        min={0}
                        digits={cfg.mode === 'count' ? 0 : 1}
                        integer={cfg.mode === 'count'}
                        suffix={cfg.mode === 'percent' ? '%' : undefined}
                        onCommit={(v) =>
                          onChange({
                            ...cfg,
                            entries: cfg.entries.map((x, j) => (j === k ? { ...x, value: v } : x)),
                          })
                        }
                      />
                    </td>
                    <td className="num muted">{cfg.mode === 'count' && sh ? pct(sh.share) : ''}</td>
                    {result && (
                      <td className={`num${off ? ' warn' : ''}`}>
                        {r ? `${r.achieved} / ${formatNumber(target, absolute ? 0 : 1)}` : '–'}
                      </td>
                    )}
                    {result && <td className="num muted">{r ? pct(r.achievedShare) : ''}</td>}
                    <td>
                      {k + 1 < cfg.entries.length && (
                        <button
                          className="icon-btn programme-link"
                          title={t('programme.merge')}
                          aria-label={`${t('programme.merge')} ${name}`}
                          onClick={() => onChange(merge(cfg, k))}
                        >
                          <Link2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="programme-total">
                <td>{t('programme.total')}</td>
                <td className="num">
                  {cfg.mode === 'percent' ? `${formatNumber(sum, 0)} %` : formatNumber(sum, 0)}
                </td>
                <td />
                {result && <td className="num">{result.total}</td>}
                {result && <td />}
                <td />
              </tr>
            </tbody>
          </table>
          {result && result.total > 0 && !absolute && (
            <p className={`muted prop-note${result.deviation >= 1 ? ' warn' : ''}`}>
              {result.deviation < 1
                ? t('programme.met')
                : t('programme.deviation', { count: Math.round(result.deviation) })}
              {result.other > 0 && <> {t('programme.other', { count: result.other })}</>}
            </p>
          )}
          <p className="muted prop-note">{t('programme.note')}</p>
        </>
      )}
    </div>
  );
}

/** Programme of a building (inspector): its own, else the project's, with target vs achieved. */
export function ProgrammeFields({
  mass,
  settings,
  update,
}: {
  mass: Mass;
  settings: Settings;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t } = useTranslation('shell');
  const analysis = useAnalysis();
  const layout = useMemo<MassLayout | undefined>(
    () => analysis?.layouts.find((m) => m.massId === mass.id),
    [analysis, mass.id],
  );
  const cfg: ProgrammeConfig = mass.programme ??
    settings.programme ?? { ...defaultProgramme(settings.unitMix), enabled: false };
  const own = !!mass.programme;
  const active = !!resolveProgramme(mass, settings);
  return (
    <Group title={t('programme.title')}>
      <ProgrammeEditor
        cfg={cfg}
        mix={settings.unitMix}
        label={t('programme.enabled')}
        result={active ? layout?.programme : undefined}
        onChange={(c) => update((m) => void (m.programme = c))}
      />
      {own && settings.programme && (
        <button className="btn btn-small" onClick={() => update((m) => void delete m.programme)}>
          {t('programme.useProject')}
        </button>
      )}
    </Group>
  );
}
