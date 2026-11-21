import type { LineAlignment, Typology } from '@kubatur/core';
import { useTranslation } from 'react-i18next';
import { typologyFields } from './typologyFields';
import { NumField } from './ui';

export function TypologyInputs(props: {
  typology: Typology;
  onChange: (recipe: (t: Typology) => void) => void;
  className?: string;
}) {
  const { t } = useTranslation('shell');
  return (
    <>
      {typologyFields(props.typology).map((f) => {
        const label = t(`param.${f.key}`);
        if (f.type === 'number')
          return (
            <label key={f.key} className={props.className ?? 'ob-field'}>
              <span>{label}</span>
              <NumField
                ariaLabel={label}
                value={f.get(props.typology)}
                integer={f.integer}
                min={f.min}
                onCommit={(v) => props.onChange((d) => f.set(d, v))}
              />
            </label>
          );
        if (f.type === 'alignment' && props.typology.kind === 'freeLine')
          return (
            <label key={f.key} className={props.className ?? 'ob-field'}>
              <span>{label}</span>
              <select
                aria-label={label}
                value={props.typology.alignment}
                onChange={(e) =>
                  props.onChange((d) => {
                    if (d.kind === 'freeLine') d.alignment = e.target.value as LineAlignment;
                  })
                }
              >
                {(['center', 'left', 'right'] as const).map((a) => (
                  <option key={a} value={a}>
                    {t(`param.align.${a}`)}
                  </option>
                ))}
              </select>
            </label>
          );
        if (f.type === 'closed' && props.typology.kind === 'freeLine')
          return (
            <label key={f.key} className={props.className ?? 'ob-field'}>
              <span>{label}</span>
              <input
                type="checkbox"
                className="switch"
                aria-label={label}
                checked={props.typology.closed}
                onChange={(e) =>
                  props.onChange((d) => {
                    if (d.kind === 'freeLine') d.closed = e.target.checked;
                  })
                }
              />
            </label>
          );
        return null;
      })}
    </>
  );
}
