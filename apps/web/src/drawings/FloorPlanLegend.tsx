import { requiredFacade, type MassLayout, type UnitRules, type UnitType } from '@kubatur/core';
import { FLOOR_PLAN_COLORS, roomColor, unitColor } from '@kubatur/drawing';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useShellStore } from '../shell/shellStore';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

/** Legend of the schematic floor plan: unit types with counts, access type, cores. */
export function FloorPlanLegend({
  layouts,
  storey,
  mix,
  rules,
}: {
  layouts: readonly MassLayout[];
  storey: number;
  mix: readonly UnitType[];
  rules: UnitRules;
}) {
  const { t } = useTranslation('drawing');
  const leftOpen = useShellStore((s) => s.leftOpen);
  const here = layouts
    .map((m) => ({ m, s: m.storeys.find((x) => x.storeyIndex === storey) }))
    .filter((x): x is { m: MassLayout; s: NonNullable<typeof x.s> } => !!x.s);
  const counts = mix
    .map((type) => {
      let count = 0;
      let area = 0;
      for (const { s } of here)
        for (const b of s.summary.byType)
          if (b.typeId === type.id) {
            count += b.count;
            area += b.area;
          }
      return { type, count, area };
    })
    .filter((c) => c.count > 0);
  const total = counts.reduce((a, c) => a + c.count, 0);
  const totalArea = counts.reduce((a, c) => a + c.area, 0);
  const outOfRange = here.some(({ s }) => s.units.some((u) => u.outOfRange));
  const failing = here.reduce((a, { s }) => a + s.summary.facadeViolations, 0);
  const rooms = here.flatMap(({ s }) => s.units.flatMap((u) => u.rooms ?? []));
  const roomFail = rooms.filter((r) => !r.facadeOk).length;
  const roomKinds = (['sejour', 'chambrePmr', 'chambre'] as const).filter((k) =>
    rooms.some((r) => r.kind === k),
  );
  const roomMin = {
    sejour: rules.livingMinFacade,
    chambrePmr: rules.pmrBedroomMinFacade,
    chambre: rules.bedroomMinFacade,
  };
  const neutral = unitColor(mix[0]?.id ?? '', mix);
  const hasOpen = here.some(({ s }) => s.open.length > 0);
  const differs = layouts.filter(
    (m) => m.areaBasedDwellings > 0 && m.totals.units !== m.areaBasedDwellings,
  );

  return (
    <aside
      className="dv-legend glass"
      style={{ left: leftOpen ? 390 : 88 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <h3 className="dv-legend-title">{t('fp.legend')}</h3>
      {here.map(({ m, s }) => (
        <p key={m.massId} className="dv-legend-access">
          <strong>{m.name}</strong> · {t(`fp.access.${s.access}`)}
          {m.expectedUnitsPerCore && s.unitsPerCore !== undefined && s.units.length > 0 && (
            <> : {t('fp.perCore', { n: fmt(s.unitsPerCore) })}</>
          )}
        </p>
      ))}
      {total > 0 ? (
        <table className="dv-legend-table">
          <tbody>
            {counts.map((c) => (
              <tr key={c.type.id}>
                <td>
                  <span
                    className="dv-legend-sw"
                    style={{ background: unitColor(c.type.id, mix) }}
                  />
                  {c.type.label}
                </td>
                <td className="num">{c.count}</td>
                <td className="num muted">{Math.round((100 * c.count) / total)} %</td>
                <td className="num muted">{fmt(c.area)} m²</td>
                <td className="num muted" title={t('fp.facadeRule')}>
                  ≥ {formatNumber(requiredFacade(c.type, rules))} m
                </td>
              </tr>
            ))}
            <tr className="dv-legend-total">
              <td>{t('fp.total')}</td>
              <td className="num">{total}</td>
              <td />
              <td className="num muted">{fmt(totalArea)} m²</td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="dv-legend-note">{t('fp.noUnits')}</p>
      )}
      {roomKinds.length > 0 && (
        <ul className="dv-legend-keys">
          {roomKinds.map((k) => (
            <li key={k}>
              <span
                className="dv-legend-sw"
                style={{ background: roomColor(neutral, k), outline: '1px solid #55534e' }}
              />
              {t(`fp.room.${k}`, { min: formatNumber(roomMin[k]) })}
            </li>
          ))}
        </ul>
      )}
      <ul className="dv-legend-keys">
        <li>
          <span className="dv-legend-sw" style={{ background: FLOOR_PLAN_COLORS.core }} />
          {t('fp.core')}
        </li>
        <li>
          <span className="dv-legend-sw" style={{ background: FLOOR_PLAN_COLORS.circulation }} />
          {t('fp.circulation')}
        </li>
        <li>
          <span
            className="dv-legend-sw dv-legend-line"
            style={{ background: FLOOR_PLAN_COLORS.facade }}
          />
          {t('fp.facadeMark')}
        </li>
        {hasOpen && (
          <li>
            <span className="dv-legend-sw" style={{ background: FLOOR_PLAN_COLORS.open }} />
            {t('fp.open')}
          </li>
        )}
      </ul>
      <p className="dv-legend-note">
        {t('fp.facadeRule')} :{' '}
        {mix.map((u) => `${u.label} ${formatNumber(requiredFacade(u, rules))} m`).join(' · ')}
      </p>
      {failing > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.facadeFail', { count: failing })}</p>
      )}
      {roomFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.roomFail', { count: roomFail })}</p>
      )}
      {outOfRange && <p className="dv-legend-note">{t('fp.outOfRange')}</p>}
      {differs.map((m) => (
        <p key={m.massId} className="dv-legend-note">
          {layouts.length > 1 && <strong>{m.name} · </strong>}
          {t('fp.differs', { layout: m.totals.units, area: m.areaBasedDwellings })}
        </p>
      ))}
    </aside>
  );
}
