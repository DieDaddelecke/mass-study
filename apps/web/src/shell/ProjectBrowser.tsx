import { polygonArea } from '@kubatur/core';
import { ChevronDown, ChevronRight, Eye, EyeOff, Hammer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { actions, useProjectStore } from '../store/projectStore';
import type { ViewId } from '../store/tools';
import { useUiStore } from '../store/uiStore';

function Node(props: {
  label: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
  active?: boolean;
  selected?: boolean;
  onOpen?: () => void;
  onSelect?: () => void;
  title?: string;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const hasChildren = props.children != null;
  return (
    <li className="tree-node">
      <div
        className={`tree-row${props.disabled ? ' disabled' : ''}${props.active ? ' active' : ''}${props.selected ? ' selected' : ''}`}
        title={props.title}
        onClick={() => (hasChildren ? setOpen(!open) : props.onSelect?.())}
        onDoubleClick={() => !props.disabled && props.onOpen?.()}
      >
        <span className="tree-twisty">
          {hasChildren ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </span>
        <span className="tree-label">{props.label}</span>
        {props.extra}
      </div>
      {hasChildren && open && <ul className="tree">{props.children}</ul>}
    </li>
  );
}

export function ProjectBrowser() {
  const { t, i18n } = useTranslation('shell');
  const project = useProjectStore((s) => s.project);
  const activeView = useUiStore((s) => s.activeView);
  const openView = useUiStore((s) => s.openView);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const prep = t('common:inPreparation');
  const view = (id: ViewId, label: string, enabled: boolean) => (
    <Node
      key={id}
      label={label}
      disabled={!enabled}
      title={enabled ? t('browser.doubleClick') : prep}
      active={activeView === id}
      onOpen={() => openView(id)}
    />
  );
  return (
    <div className="palette">
      <div className="palette-head">{t('browser.title')}</div>
      {!project ? (
        <div className="palette-empty">{t('props.noProject')}</div>
      ) : (
        <ul className="tree tree-root">
          <Node label={t('browser.views')} defaultOpen>
            <Node label={t('browser.views3d')} defaultOpen>
              {view('3d', '{3D}', true)}
              {view('axoSW', t('views.axoSW'), false)}
              {view('axoNE', t('views.axoNE'), false)}
            </Node>
            {view('site', t('views.site'), false)}
            <Node label={t('views.elevations')} title={prep}>
              {view('elevN', t('views.elevN'), false)}
              {view('elevE', t('views.elevE'), false)}
              {view('elevS', t('views.elevS'), false)}
              {view('elevW', t('views.elevW'), false)}
            </Node>
            <Node label={t('views.sections')} title={prep}>
              {view('sectionA', t('views.sectionA'), false)}
              {view('sectionB', t('views.sectionB'), false)}
            </Node>
          </Node>
          <Node label={t('browser.schedules')}>
            <Node label={t('ribbon.areaTable')} disabled title={prep} />
            <Node label={t('ribbon.kpis')} disabled title={prep} />
            <Node label={t('ribbon.unitMix')} disabled title={prep} />
          </Node>
          <Node label={t('browser.variants')} defaultOpen>
            {project.variants.map((v) => (
              <Node
                key={v.id}
                label={`${v.id === project.activeVariantId ? '● ' : '○ '}${v.name}`}
                active={v.id === project.activeVariantId}
                onOpen={() => actions.setActiveVariant(v.id)}
                onSelect={() => undefined}
              />
            ))}
          </Node>
          <Node label={t('browser.site')} defaultOpen>
            <Node label={t('browser.parcels', { count: project.site.parcels.length })} defaultOpen>
              {project.site.parcels.map((p) => (
                <Node
                  key={p.id}
                  label={`${p.ref ?? p.id} · ${formatNumber(polygonArea(p.polygon), 0, i18n.language)} m²`}
                />
              ))}
            </Node>
            <Node label={t('browser.context', { count: project.context.length })}>
              {project.context.map((c, i) => (
                <Node
                  key={c.id}
                  selected={selection.includes(c.id)}
                  onSelect={() => setSelection([c.id])}
                  label={
                    <span className={c.hidden || c.demolished ? 'muted' : undefined}>
                      {t('browser.building', { n: i + 1 })} ·{' '}
                      {formatNumber(c.height, 1, i18n.language)} m{c.heightEstimated ? '*' : ''}
                    </span>
                  }
                  extra={
                    <span className="tree-actions">
                      <button
                        className="icon-btn"
                        title={c.hidden ? t('browser.show') : t('browser.hide')}
                        aria-label={c.hidden ? t('browser.show') : t('browser.hide')}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.updateContextBuilding(c.id, (d) => void (d.hidden = !c.hidden));
                        }}
                      >
                        {c.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button
                        className={`icon-btn${c.demolished ? ' on' : ''}`}
                        title={t('props.demolished')}
                        aria-label={t('props.demolished')}
                        aria-pressed={!!c.demolished}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.updateContextBuilding(
                            c.id,
                            (d) => void (d.demolished = !c.demolished),
                          );
                        }}
                      >
                        <Hammer size={12} />
                      </button>
                    </span>
                  }
                />
              ))}
            </Node>
          </Node>
        </ul>
      )}
    </div>
  );
}
