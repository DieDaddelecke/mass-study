import { PLANTING_KINDS, USAGES, type PlantingKind, type Usage } from '@kubatur/core';
import { produce } from 'immer';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../store/uiStore';
import { escape } from './commands';
import { TypologyInputs } from './TypologyInputs';
import { Segmented } from './ui';

/** Floating contextual bar (top centre) while a tool is active, with the status hint below. */
export function ToolPill() {
  const { t } = useTranslation('shell');
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const hint = useUiStore((s) => s.hint);
  if (tool.kind === 'select') {
    return hint ? (
      <div className="toolpill-wrap">
        <div className="toolpill-hint">{hint}</div>
      </div>
    ) : null;
  }
  return (
    <div className="toolpill-wrap">
      <div className="glass toolpill" role="toolbar" aria-label={t('options.label')}>
        {tool.kind === 'place' ? (
          <>
            <span className="tp-title">
              {t('options.place', {
                name: tool.template
                  ? t(`common:template.${tool.template}`)
                  : t(`common:typology.${tool.typologyKind}`),
              })}
            </span>
            <TypologyInputs
              typology={tool.typology}
              className="tp-field"
              onChange={(recipe) => setTool({ ...tool, typology: produce(tool.typology, recipe) })}
            />
            <label className="tp-field">
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
          </>
        ) : tool.kind === 'align' ? (
          <>
            <span className="tp-title">{t('ribbon.tool.align')}</span>
            <Segmented
              ariaLabel={t('align.mode')}
              value={tool.mode ?? 'facade'}
              onChange={(mode) => setTool({ ...tool, mode })}
              options={[
                { value: 'facade', label: t('align.facade') },
                { value: 'volume', label: t('align.volume') },
              ]}
            />
          </>
        ) : tool.kind === 'drawGreen' ? (
          <>
            <span className="tp-title">{t('ribbon.tool.drawGreen')}</span>
            <label className="tp-field">
              <span>{t('green.kind')}</span>
              <select
                aria-label={t('green.kind')}
                value={tool.plantingKind}
                onChange={(e) => setTool({ ...tool, plantingKind: e.target.value as PlantingKind })}
              >
                {PLANTING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`green.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <span className="tp-title">{t(`ribbon.tool.${tool.kind}`)}</span>
        )}
        <button
          type="button"
          className="tp-close"
          aria-label={t('options.cancel')}
          title={`${t('options.cancel')} (Esc)`}
          onClick={escape}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      {hint && <div className="toolpill-hint">{hint}</div>}
    </div>
  );
}
