import {
  requiredFacade,
  unitOutdoors,
  type MassLayout,
  type UnitRules,
  type UnitType,
} from '@kubatur/core';
import { FLOOR_PLAN_COLORS, roomColor, unitColor } from '@kubatur/drawing';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useShellStore } from '../shell/shellStore';
import { UsesLegend } from './UsesLegend';

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
      let duplex = 0;
      for (const { s } of here)
        for (const b of s.summary.byType)
          if (b.typeId === type.id) {
            count += b.count;
            area += b.area;
            duplex += b.duplex ?? 0;
          }
      return { type, count, area, duplex };
    })
    .filter((c) => c.count > 0 || c.area > 0);
  const total = counts.reduce((a, c) => a + c.count, 0);
  const special = here.some(({ s }) => s.residence || s.office);
  const totalArea = counts.reduce((a, c) => a + c.area, 0);
  const outOfRange = here.some(({ s }) => s.units.some((u) => u.outOfRange));
  const failing = here.reduce((a, { s }) => a + s.summary.facadeViolations, 0);
  const rooms = here.flatMap(({ s }) => s.units.flatMap((u) => u.rooms ?? []));
  const roomFail = rooms.filter((r) => !r.facadeOk).length;
  const areaFail = rooms.filter((r) => r.areaOk === false).length;
  const galleryRooms = rooms.filter((r) => r.onGallery).length;
  const roomKinds = (['sejour', 'cuisine', 'chambrePmr', 'chambre'] as const).filter((k) =>
    rooms.some((r) => r.kind === k),
  );
  const roomMin = {
    sejour: rules.livingMinFacade,
    cuisine: rules.kitchenMinFacade ?? 2.15,
    chambrePmr: rules.pmrBedroomMinFacade,
    chambre: rules.bedroomMinFacade,
  };
  const hasWet = rooms.some((r) => r.kind === 'sdb' || r.kind === 'gaine');
  const hasHall = rooms.some((r) => r.kind === 'degagement');
  const units = here.flatMap(({ s }) => s.units);
  const outdoor = units.filter((u) => u.outdoor);
  const ratioFail = units.filter(
    (u) => u.facadeRatioOk === false && u.duplex?.level !== 'nuit',
  ).length;
  const accessFail = units.filter((u) => u.accessOk === false).length;
  const dwellings = units.filter((u) => !u.duplex && !u.spaces);
  const fromLibrary = dwellings.filter((u) => u.template).length;
  const oversize = units.filter((u) => u.outOfRange && u.duplex?.level !== 'nuit').length;
  const orientFail = units.filter(
    (u) => u.orientationOk === false && u.duplex?.level !== 'nuit',
  ).length;
  const outdoorFail = outdoor.filter((u) => !u.outdoor!.ok).length;
  const nuit = units.filter((u) => u.duplex?.level === 'nuit').length;
  const outdoorNone = units.length - nuit - outdoor.length;
  const outdoorArea = units.reduce(
    (a, u) => a + unitOutdoors(u).reduce((x, o) => x + o.area, 0),
    0,
  );
  const extraOutdoor = units.reduce((a, u) => a + (u.outdoorExtra?.length ?? 0), 0);
  const neutral = unitColor(mix[0]?.id ?? '', mix);
  const hasOpen = here.some(({ s }) => s.open.length > 0);
  const blind = here.reduce(
    (a, { s }) =>
      a + (s.blindFacades ?? []).reduce((x, [p, q]) => x + Math.hypot(q[0] - p[0], q[1] - p[1]), 0),
    0,
  );
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
      {total > 0 || nuit > 0 ? (
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
                  {c.duplex > 0 && (
                    <span className="muted"> · {t('fp.duplexCount', { count: c.duplex })}</span>
                  )}
                </td>
                <td className="num">{c.count}</td>
                <td className="num muted">{Math.round((100 * c.count) / total)} %</td>
                <td className="num muted">{fmt(c.area)} m²</td>
                <td className="num muted" title={t('fp.facadeRule')}>
                  ≥{' '}
                  {formatNumber(
                    requiredFacade(
                      c.duplex > 0 && c.duplex === c.count ? { ...c.type, duplex: true } : c.type,
                      rules,
                    ),
                  )}{' '}
                  m
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
      ) : special ? null : (
        <p className="dv-legend-note">{t('fp.noUnits')}</p>
      )}
      <UsesLegend storeys={here.map((x) => x.s)} />
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
          {hasWet && (
            <li>
              <span
                className="dv-legend-sw"
                style={{ background: roomColor(neutral, 'sdb'), outline: '1px solid #55534e' }}
              />
              {t('fp.room.wet')}
            </li>
          )}
          {hasHall && (
            <li>
              <span
                className="dv-legend-sw"
                style={{
                  background: roomColor(neutral, 'degagement'),
                  outline: '1px solid #55534e',
                }}
              />
              {t('fp.room.degagement')}
            </li>
          )}
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
        {blind > 0 && (
          <li>
            <span
              className="dv-legend-sw dv-legend-line"
              style={{ background: FLOOR_PLAN_COLORS.blind }}
            />
            {t('fp.blindFacade')} · {formatNumber(blind, 1)} m
          </li>
        )}
        {outdoor.length > 0 && (
          <li>
            <span
              className="dv-legend-sw"
              style={{
                background: FLOOR_PLAN_COLORS.outdoor,
                outline: `1px solid ${FLOOR_PLAN_COLORS.outdoorLine}`,
              }}
            />
            {t('fp.outdoor')} · {fmt(outdoorArea)} m²
          </li>
        )}
        {units.some((u) => u.duplex?.stair) && (
          <li>
            <span
              className="dv-legend-sw"
              style={{ background: '#fff', outline: '1px solid #55534e' }}
            />
            {t('fp.duplexStair')}
          </li>
        )}
        {hasOpen && (
          <li>
            <span className="dv-legend-sw" style={{ background: FLOOR_PLAN_COLORS.open }} />
            {t('fp.open')}
          </li>
        )}
      </ul>
      <p className="dv-legend-note" hidden={special && total === 0}>
        {t('fp.facadeRule')} :{' '}
        {mix.map((u) => `${u.label} ${formatNumber(requiredFacade(u, rules))} m`).join(' · ')}
      </p>
      {rules.planLibrary !== false && dwellings.length > 0 && (
        <p className="dv-legend-note">
          {t('fp.library', { n: fromLibrary, total: dwellings.length })}
        </p>
      )}
      {failing > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.facadeFail', { count: failing })}</p>
      )}
      {ratioFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">
          {t('fp.ratioFail', {
            count: ratioFail,
            pct: Math.round((rules.facadeAreaRatio ?? 0.12) * 100),
          })}
        </p>
      )}
      {accessFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.accessFail', { count: accessFail })}</p>
      )}
      {oversize > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.oversizeFail', { count: oversize })}</p>
      )}
      {orientFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.orientFail', { count: orientFail })}</p>
      )}
      {galleryRooms > 0 && (
        <p className="dv-legend-note dv-legend-warn">
          {t('fp.galleryRoom', { count: galleryRooms })}
        </p>
      )}
      {areaFail > 0 && <p className="dv-legend-note">{t('fp.areaFail', { count: areaFail })}</p>}
      {roomFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">{t('fp.roomFail', { count: roomFail })}</p>
      )}
      {outdoorFail > 0 && (
        <p className="dv-legend-note dv-legend-warn">
          {t('fp.outdoorFail', { count: outdoorFail })}
        </p>
      )}
      {outdoorNone > 0 && outdoor.length > 0 && (
        <p className="dv-legend-note">{t('fp.outdoorNone', { count: outdoorNone })}</p>
      )}
      {extraOutdoor > 0 && (
        <p className="dv-legend-note">{t('fp.outdoorStacked', { count: extraOutdoor })}</p>
      )}
      {nuit > 0 && <p className="dv-legend-note">{t('fp.duplexNuit', { count: nuit })}</p>}
      {layouts
        .filter((m) => m.programme && m.programme.total > 0)
        .map((m) => (
          <p
            key={`p${m.massId}`}
            className={`dv-legend-note${m.programme!.deviation >= 1 ? ' dv-legend-warn' : ''}`}
          >
            <strong>
              {t('fp.programme')}
              {layouts.length > 1 ? ` ${m.name}` : ''} :
            </strong>{' '}
            {m
              .programme!.entries.map(
                (e) => `${e.label} ${e.achieved}/${formatNumber(e.target, 0)}`,
              )
              .join(' · ')}{' '}
            ({t('fp.programmeWhole')})
          </p>
        ))}
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
