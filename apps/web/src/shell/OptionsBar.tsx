import { USAGES, type LineAlignment, type Typology, type Usage } from '@kubatur/core';
import { produce } from 'immer';
import { useTranslation } from 'react-i18next';
import { activeVariant, useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
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

export function OptionsBar() {
  const { t } = useTranslation('shell');
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const selection = useUiStore((s) => s.selection);
  const project = useProjectStore((s) => s.project);

  if (tool.kind === 'place') {
    return (
      <div className="optionsbar">
        <span className="ob-title">
          {t('options.place', {
            name: tool.template
              ? t(`common:template.${tool.template}`)
              : t(`common:typology.${tool.typologyKind}`),
          })}
        </span>
        <TypologyInputs
          typology={tool.typology}
          onChange={(recipe) => setTool({ ...tool, typology: produce(tool.typology, recipe) })}
        />
        <label className="ob-field">
          <span>{t('props.usage')}</span>
          <select
            aria-label={t('props.usage')}
            value={tool.usage}
            onChange={(e) => setTool({ ...tool, usage: e.target.value as Usage })}
          >
            {USAGES.map((u) => (
              <option key={u} value={u}>
                {t(`common:usage.${u}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (tool.kind !== 'select') {
    return (
      <div className="optionsbar">
        <span className="ob-title">{t(`ribbon.tool.${tool.kind}`)}</span>
      </div>
    );
  }
  if (project && selection.length) {
    const v = activeVariant(project);
    const masses = v.masses.filter((m) => selection.includes(m.id));
    const ctx = project.context.filter((c) => selection.includes(c.id));
    return (
      <div className="optionsbar">
        <span className="ob-title">{t('options.selection', { count: selection.length })}</span>
        {masses.length > 0 && (
          <span className="ob-note">
            {masses.map((m) => `${m.name} (${t(`common:typology.${m.typology.kind}`)})`).join(', ')}
          </span>
        )}
        {ctx.length > 0 && (
          <span className="ob-note">{t('options.contextBuildings', { count: ctx.length })}</span>
        )}
      </div>
    );
  }
  return (
    <div className="optionsbar">
      <span className="ob-title">{t('options.modify')}</span>
    </div>
  );
}
