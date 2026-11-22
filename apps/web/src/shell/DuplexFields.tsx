import {
  duplexTypeIds,
  massLayouts,
  resolveDuplex,
  storeyLabel,
  type Mass,
  unitRooms,
  type Settings,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysis } from '../store/useAnalysis';
import { Group, Row } from './ui';

/**
 * Duplex dwellings of a building (inspector): on/off, lowest storey (default R+3), entrance
 * level (the séjour level) and the unit types built as duplex.
 */
export function DuplexFields({
  mass,
  settings,
  update,
}: {
  mass: Mass;
  settings: Settings;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t } = useTranslation('shell');
  const cfg = resolveDuplex(mass, settings);
  const mix = settings.unitMix.filter((u) => u.share > 0);
  const ids = duplexTypeIds(settings.unitMix, cfg);
  const analysis = useAnalysis();
  const count = useMemo(() => {
    if (!cfg.enabled || !analysis) return null;
    const ml = massLayouts(analysis.result, settings).find((m) => m.massId === mass.id);
    return ml ? ml.totals.byType.reduce((s, b) => s + (b.duplex ?? 0), 0) : null;
  }, [analysis, settings, mass.id, cfg.enabled]);
  const edit = (recipe: (d: NonNullable<Mass['duplex']>) => void) =>
    update((m) => {
      const d = { ...resolveDuplex(m as Mass, settings) };
      recipe(d);
      m.duplex = d;
    });
  const top = mass.storeys.upper.count;
  const label = (i: number) =>
    storeyLabel(i, settings.notation, false, mass.storeys.basement.count);
  const from = Array.from({ length: Math.max(0, top) }, (_, i) => i + 1);
  return (
    <Group title={t('duplex.title')}>
      <Row label={t('duplex.enabled')}>
        <input
          type="checkbox"
          aria-label={t('duplex.enabled')}
          checked={cfg.enabled}
          onChange={(e) => edit((d) => void (d.enabled = e.target.checked))}
        />
      </Row>
      {cfg.enabled && (
        <>
          <Row label={t('duplex.from')}>
            <select
              aria-label={t('duplex.from')}
              value={cfg.fromStorey}
              onChange={(e) => edit((d) => void (d.fromStorey = Number(e.target.value)))}
            >
              {(from.includes(cfg.fromStorey) ? from : [...from, cfg.fromStorey]).map((i) => (
                <option key={i} value={i}>
                  {label(i)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('duplex.entry')}>
            <select
              aria-label={t('duplex.entry')}
              value={cfg.entry}
              onChange={(e) => edit((d) => void (d.entry = e.target.value as 'lower' | 'upper'))}
            >
              <option value="lower">{t('duplex.entryLower')}</option>
              <option value="upper">{t('duplex.entryUpper')}</option>
            </select>
          </Row>
          <Row label={t('duplex.types')}>
            <span className="row-inline duplex-types">
              {mix
                .filter((u) => unitRooms(u) >= 2)
                .map((u) => (
                  <label key={u.id} className="suit">
                    <input
                      type="checkbox"
                      aria-label={`${t('duplex.types')} ${u.label}`}
                      checked={ids.includes(u.id)}
                      onChange={(e) =>
                        edit((d) => {
                          const cur = duplexTypeIds(settings.unitMix, d);
                          d.types = e.target.checked
                            ? [...cur, u.id]
                            : cur.filter((x) => x !== u.id);
                        })
                      }
                    />
                    {u.label}
                  </label>
                ))}
            </span>
          </Row>
          {count !== null && (
            <p className={`muted prop-note${count === 0 ? ' warn' : ''}`}>
              {count > 0 ? t('duplex.count', { count }) : t('duplex.none')}
            </p>
          )}
          <p className="muted prop-note">{t('duplex.note', { storey: label(cfg.fromStorey) })}</p>
        </>
      )}
    </Group>
  );
}
