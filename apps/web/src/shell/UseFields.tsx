import {
  massLayout,
  massToSolids,
  resolveOfficeRules,
  resolveResidenceRules,
  usesTotals,
  type Mass,
  type OfficeLayoutKind,
  type ResidenceRules,
  type ResidenceVariant,
  type OfficeRules,
  type Settings,
  type Usage,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { Group, NumField, Row, Segmented } from './ui';

/** True when a storey of the mass has the usage (default or per storey). */
export function massHasUsage(mass: Pick<Mass, 'usage' | 'usageByStorey'>, u: Usage): boolean {
  return (mass.usage ?? 'wohnen') === u || Object.values(mass.usageByStorey ?? {}).includes(u);
}

type Update = (recipe: (m: Draft<Mass>) => void) => void;

/**
 * Residence (Wohnheim) and office (Büro) settings of a building in the inspector, with the
 * resulting units / beds or workstations of its schematic floor plans.
 */
export function UseFields({
  mass,
  settings,
  update,
}: {
  mass: Mass;
  settings: Settings;
  update: Update;
}) {
  const res = massHasUsage(mass, 'wohnheim');
  const off = massHasUsage(mass, 'buero');
  const totals = useMemo(() => {
    if (!res && !off) return null;
    try {
      const l = massLayout(mass, massToSolids(mass, settings), settings);
      return usesTotals(l.storeys);
    } catch {
      return null;
    }
  }, [mass, settings, res, off]);
  return (
    <>
      {res && <ResidenceFields mass={mass} settings={settings} update={update} totals={totals} />}
      {off && <OfficeFields mass={mass} settings={settings} update={update} totals={totals} />}
    </>
  );
}

function ResidenceFields({
  mass,
  settings,
  update,
  totals,
}: {
  mass: Mass;
  settings: Settings;
  update: Update;
  totals: ReturnType<typeof usesTotals> | null;
}) {
  const { t, i18n } = useTranslation('shell');
  const n = (v: number, d = 0) => formatNumber(v, d, i18n.language);
  const r = resolveResidenceRules(mass, settings);
  const set = <K extends keyof ResidenceRules>(k: K, v: ResidenceRules[K]) =>
    update((m) => {
      m.residence = { ...(m.residence ?? {}), [k]: v };
    });
  const num = (k: 'studioWidth' | 'pmrWidth' | 'cornerWidth' | 'corridorWidth', label: string) => (
    <Row label={label}>
      <NumField
        ariaLabel={label}
        value={r[k]}
        digits={2}
        min={1}
        max={20}
        suffix="m"
        onCommit={(v) => set(k, v)}
      />
    </Row>
  );
  const tr = totals?.residence;
  return (
    <Group title={t('uses.residence.title')}>
      <Row label={t('uses.residence.variant')}>
        <Segmented<ResidenceVariant>
          ariaLabel={t('uses.residence.variant')}
          value={r.variant}
          options={[
            { value: 'etudiant', label: t('uses.residence.etudiant') },
            { value: 'senior', label: t('uses.residence.senior') },
          ]}
          // a new variant starts from its own defaults
          onChange={(v) => update((m) => void (m.residence = { variant: v }))}
        />
      </Row>
      {num('studioWidth', t('uses.residence.studioWidth'))}
      {num('pmrWidth', t('uses.residence.pmrWidth'))}
      {num('cornerWidth', t('uses.residence.cornerWidth'))}
      {num('corridorWidth', t('uses.residence.corridorWidth'))}
      <Row label={t('uses.residence.pmrShare')}>
        <NumField
          ariaLabel={t('uses.residence.pmrShare')}
          value={r.pmrShare * 100}
          digits={0}
          min={0}
          max={100}
          suffix="%"
          onCommit={(v) => set('pmrShare', v / 100)}
        />
      </Row>
      <Row label={t('uses.residence.commonPerUnit')}>
        <NumField
          ariaLabel={t('uses.residence.commonPerUnit')}
          value={r.commonPerUnit}
          digits={1}
          min={0}
          max={10}
          suffix="m²"
          onCommit={(v) => set('commonPerUnit', v)}
        />
      </Row>
      {tr && (
        <p className="muted prop-note">
          {t('uses.residence.result', {
            units: tr.units,
            beds: tr.beds,
            pmr: tr.pmr,
            avg: n(tr.units ? tr.unitArea / tr.units : 0, 1),
            common: n(tr.commonArea),
          })}
        </p>
      )}
      <p className="muted prop-note">{t('uses.residence.note')}</p>
    </Group>
  );
}

function OfficeFields({
  mass,
  settings,
  update,
  totals,
}: {
  mass: Mass;
  settings: Settings;
  update: Update;
  totals: ReturnType<typeof usesTotals> | null;
}) {
  const { t, i18n } = useTranslation('shell');
  const n = (v: number, d = 0) => formatNumber(v, d, i18n.language);
  const o = resolveOfficeRules(mass, settings);
  const set = <K extends keyof OfficeRules>(k: K, v: OfficeRules[K]) =>
    update((m) => {
      m.office = { ...(m.office ?? {}), [k]: v };
    });
  const to = totals?.office;
  return (
    <Group title={t('uses.office.title')}>
      <Row label={t('uses.office.layout')}>
        <select
          aria-label={t('uses.office.layout')}
          value={o.layout}
          onChange={(e) => set('layout', e.target.value as OfficeLayoutKind)}
        >
          {(['openSpace', 'cellulaire', 'mixte'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`uses.office.${k}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('uses.office.grid')}>
        <NumField
          ariaLabel={t('uses.office.grid')}
          value={o.grid}
          digits={2}
          min={0.9}
          max={2}
          suffix="m"
          onCommit={(v) => set('grid', v)}
        />
      </Row>
      <Row label={t('uses.office.areaPerDesk')}>
        <NumField
          ariaLabel={t('uses.office.areaPerDesk')}
          value={o.areaPerDeskOpen}
          digits={1}
          min={5}
          max={30}
          suffix="m²"
          onCommit={(v) => set('areaPerDeskOpen', v)}
        />
      </Row>
      <Row label={t('uses.office.maxDepth')}>
        <NumField
          ariaLabel={t('uses.office.maxDepth')}
          value={o.maxFacadeDistance}
          digits={1}
          min={3}
          max={15}
          suffix="m"
          onCommit={(v) => set('maxFacadeDistance', v)}
        />
      </Row>
      {to && (
        <p className="muted prop-note">
          {t('uses.office.result', {
            desks: to.desks,
            usable: n(to.usable),
            ratio: n(to.floorArea ? (100 * to.usable) / to.floorArea : 0),
            perDesk: n(to.desks ? to.usable / to.desks : 0, 1),
            meetings: to.meetingRooms,
          })}
        </p>
      )}
      {to && to.deepStoreys > 0 && (
        <p className="muted prop-note warn">{t('uses.office.deep', { count: to.deepStoreys })}</p>
      )}
    </Group>
  );
}
