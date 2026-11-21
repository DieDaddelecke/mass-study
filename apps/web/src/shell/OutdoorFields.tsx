import {
  FACADE_SIDES,
  outdoorMinDepth,
  resolveOutdoor,
  resolveOutdoorRules,
  type FacadeSide,
  type Mass,
  type OutdoorKind,
  type Settings,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { Group, NumField, Row } from './ui';

const KINDS: OutdoorKind[] = ['none', 'balcon', 'loggia'];

/**
 * Outdoor spaces of a building (inspector): kind and depth for all façades, optional overrides
 * per orientation, terraces on the ground floor.
 */
export function OutdoorFields({
  mass,
  settings,
  update,
}: {
  mass: Mass;
  settings: Settings;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t, i18n } = useTranslation('shell');
  const cfg = resolveOutdoor(mass, settings);
  const rules = resolveOutdoorRules(settings);
  const edit = (recipe: (o: NonNullable<Mass['outdoor']>) => void) =>
    update((m) => {
      const o = { ...resolveOutdoor(m as Mass, settings) };
      o.sides = { ...(o.sides ?? {}) };
      recipe(o);
      if (!Object.keys(o.sides).length) delete o.sides;
      m.outdoor = o;
    });
  const minOf = (k: OutdoorKind) => (k === 'none' ? 0 : outdoorMinDepth(k, rules));
  const kindSelect = (
    label: string,
    value: OutdoorKind | '',
    onChange: (v: OutdoorKind | '') => void,
    inherit: boolean,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as OutdoorKind | '')}
    >
      {inherit && <option value="">{t('outdoor.inherit')}</option>}
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {t(`outdoor.kind.${k}`)}
        </option>
      ))}
    </select>
  );
  return (
    <Group title={t('outdoor.title')}>
      <Row label={t('outdoor.all')}>
        {kindSelect(
          t('outdoor.all'),
          cfg.kind,
          (v) => edit((o) => void (o.kind = (v || 'none') as OutdoorKind)),
          false,
        )}
      </Row>
      {cfg.kind !== 'none' && (
        <Row label={t('outdoor.depth')}>
          <NumField
            ariaLabel={t('outdoor.depth')}
            value={cfg.depth}
            min={minOf(cfg.kind)}
            suffix="m"
            onCommit={(v) => edit((o) => void (o.depth = v))}
          />
        </Row>
      )}
      {FACADE_SIDES.map((side: FacadeSide) => {
        const sc = cfg.sides?.[side];
        const label = t(`outdoor.side.${side}`);
        return (
          <Row key={side} label={label}>
            <span className="row-inline">
              {kindSelect(
                label,
                sc?.kind ?? '',
                (v) =>
                  edit((o) => {
                    if (!v) delete o.sides![side];
                    else
                      o.sides![side] = {
                        kind: v,
                        depth: Math.max(sc?.depth ?? o.depth, minOf(v)),
                      };
                  }),
                true,
              )}
              {sc && sc.kind !== 'none' && (
                <NumField
                  ariaLabel={`${label} – ${t('outdoor.depth')}`}
                  value={sc.depth}
                  min={minOf(sc.kind)}
                  suffix="m"
                  onCommit={(v) => edit((o) => void (o.sides![side] = { ...sc, depth: v }))}
                />
              )}
            </span>
          </Row>
        );
      })}
      <Row label={t('outdoor.groundTerrace')}>
        <input
          type="checkbox"
          aria-label={t('outdoor.groundTerrace')}
          checked={cfg.groundTerrace}
          onChange={(e) => edit((o) => void (o.groundTerrace = e.target.checked))}
        />
      </Row>
      <p className="muted prop-note">
        {t('outdoor.note', {
          area: formatNumber(rules.minArea, 0, i18n.language),
          loggia: formatNumber(rules.loggiaMinDepth, 2, i18n.language),
          balcon: formatNumber(rules.balconMinDepth, 2, i18n.language),
        })}
      </p>
    </Group>
  );
}
