import { usesTotals, type SpaceKind, type StoreyLayout } from '@kubatur/core';
import { RESIDENCE_COLORS, SPACE_COLORS } from '@kubatur/drawing';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';

/** Part of the floor-plan legend for residence and office storeys: units / desks, room keys. */
export function UsesLegend({ storeys }: { storeys: readonly StoreyLayout[] }) {
  const { t, i18n } = useTranslation('drawing');
  const n = (v: number, d = 0) => formatNumber(v, d, i18n.language);
  const tot = usesTotals(storeys);
  if (!tot.residence && !tot.office) return null;
  const kinds = new Set<SpaceKind>();
  for (const st of storeys) {
    for (const s of st.spaces ?? []) kinds.add(s.kind);
    for (const u of st.units) for (const s of u.spaces ?? []) kinds.add(s.kind);
  }
  kinds.delete('kitchenette');
  const office = storeys.find((s) => s.office)?.office;
  return (
    <>
      {tot.residence && (
        <table className="dv-legend-table">
          <tbody>
            {tot.residence.byType.map((b) => (
              <tr key={b.typeId}>
                <td>
                  <span
                    className="dv-legend-sw"
                    style={{ background: RESIDENCE_COLORS[b.typeId] ?? '#ccc' }}
                  />
                  {b.label}
                </td>
                <td className="num">{b.count}</td>
                <td className="num muted">Ø {n(b.count ? b.area / b.count : 0, 1)} m²</td>
              </tr>
            ))}
            <tr className="dv-legend-total">
              <td>{t('fp.uses.residenceTotal')}</td>
              <td className="num">{tot.residence.units}</td>
              <td className="num muted">{t('fp.uses.beds', { count: tot.residence.beds })}</td>
            </tr>
          </tbody>
        </table>
      )}
      {tot.office && (
        <p className="dv-legend-access">
          {office && <strong>{t(`fp.uses.layout.${office.layout}`)} · </strong>}
          {t('fp.uses.office', {
            desks: tot.office.desks,
            usable: n(tot.office.usable),
            meetings: tot.office.meetingRooms,
          })}
        </p>
      )}
      <ul className="dv-legend-keys">
        {[...kinds].map((k) => (
          <li key={k}>
            <span
              className="dv-legend-sw"
              style={{ background: SPACE_COLORS[k], outline: '1px solid #55534e' }}
            />
            {t(`fp.uses.space.${k}`)}
          </li>
        ))}
      </ul>
      {tot.office && tot.office.deepStoreys > 0 && office && (
        <p className="dv-legend-note dv-legend-warn">
          {t('fp.uses.deep', { distance: n(office.facadeDistance, 1) })}
        </p>
      )}
    </>
  );
}
