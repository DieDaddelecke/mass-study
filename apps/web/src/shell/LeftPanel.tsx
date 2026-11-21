import * as Tabs from '@radix-ui/react-tabs';
import { polygonArea } from '@kubatur/core';
import {
  Box,
  Building2,
  Check,
  Cuboid,
  Droplets,
  Eye,
  EyeOff,
  Frame,
  Columns3,
  LandPlot,
  PanelLeftClose,
  RefreshCw,
  Route,
  ScanLine,
  Table2,
  Trees,
  TreeDeciduous,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { actions, activeVariant, useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import type { ViewId } from '../store/tools';
import { usageColor } from '../viewport/scene/colors';
import { useViewportStore, type ContextLayers } from '../viewport/viewportStore';
import { reloadContext } from './commands';
import { useShellStore, type LeftTab } from './shellStore';
import { IconButton, Segmented } from './ui';

function MassName({ id, name }: { id: string; name: string }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit !== null)
    return (
      <input
        className="list-input"
        autoFocus
        value={edit}
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={() => {
          if (edit.trim() && edit !== name)
            actions.updateMass(id, (m) => void (m.name = edit.trim()));
          setEdit(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEdit(null);
        }}
      />
    );
  return (
    <span className="list-text" onDoubleClick={() => setEdit(name)}>
      {name}
    </span>
  );
}

function ProjectTab() {
  const { t, i18n } = useTranslation('shell');
  const project = useProjectStore((s) => s.project)!;
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const variant = activeVariant(project);
  const n = (v: number) => formatNumber(v, 0, i18n.language);
  return (
    <div className="lp-scroll">
      <section className="section">
        <h3 className="label">{t('browser.variants')}</h3>
        <ul className="list">
          {project.variants.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={`list-row${v.id === project.activeVariantId ? ' is-active' : ''}`}
                onClick={() => actions.setActiveVariant(v.id)}
              >
                <span className="list-check">
                  {v.id === project.activeVariantId && <Check size={14} />}
                </span>
                <span className="list-text">{v.name}</span>
                <span className="list-meta">{v.masses.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h3 className="label">
          {t('panel.masses')} <span className="label-count">{variant.masses.length}</span>
        </h3>
        {variant.masses.length === 0 ? (
          <p className="empty">{t('panel.noMasses')}</p>
        ) : (
          <ul className="list" title={t('panel.renameHint')}>
            {variant.masses.map((m) => (
              <li key={m.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`list-row${selection.includes(m.id) ? ' is-selected' : ''}`}
                  onClick={(e) =>
                    setSelection(
                      e.shiftKey || e.ctrlKey || e.metaKey
                        ? selection.includes(m.id)
                          ? selection.filter((x) => x !== m.id)
                          : [...selection, m.id]
                        : [m.id],
                    )
                  }
                  onKeyDown={(e) => e.key === 'Enter' && setSelection([m.id])}
                >
                  <span
                    className="usage-dot"
                    style={{ background: usageColor(m.usage ?? 'wohnen') }}
                    title={t(`common:usage.${m.usage ?? 'wohnen'}`)}
                  />
                  <MassName id={m.id} name={m.name} />
                  <span className="list-meta">{t(`common:typology.${m.typology.kind}`)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <h3 className="label">
          {t('panel.parcels')} <span className="label-count">{project.site.parcels.length}</span>
        </h3>
        <ul className="list">
          {project.site.parcels.map((p) => (
            <li key={p.id} className="list-row is-static">
              <LandPlot size={14} strokeWidth={1.75} className="muted-icon" />
              <span className="list-text">{p.ref ?? p.id}</span>
              <span className="list-meta">{n(polygonArea(p.polygon))} m²</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h3 className="label">
          {t('panel.context')} <span className="label-count">{project.context.length}</span>
        </h3>
        <ul className="list list-compact">
          {project.context.map((c, i) => (
            <li key={c.id}>
              <div
                role="button"
                tabIndex={0}
                className={`list-row${selection.includes(c.id) ? ' is-selected' : ''}`}
                onClick={() => setSelection([c.id])}
                onKeyDown={(e) => e.key === 'Enter' && setSelection([c.id])}
              >
                <Building2 size={14} strokeWidth={1.75} className="muted-icon" />
                <span className={`list-text${c.hidden || c.demolished ? ' is-muted' : ''}`}>
                  {t('browser.building', { n: i + 1 })}
                </span>
                <span className="list-meta">
                  {formatNumber(c.height, 1, i18n.language)} m{c.heightEstimated ? '*' : ''}
                </span>
                <button
                  type="button"
                  className="mini-btn"
                  aria-label={c.hidden ? t('browser.show') : t('browser.hide')}
                  title={c.hidden ? t('browser.show') : t('browser.hide')}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.updateContextBuilding(c.id, (d) => void (d.hidden = !c.hidden));
                  }}
                >
                  {c.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const LAYERS: { key: Exclude<keyof ContextLayers, 'basemap'>; icon: LucideIcon }[] = [
  { key: 'buildings', icon: Building2 },
  { key: 'roads', icon: Route },
  { key: 'green', icon: Trees },
  { key: 'trees', icon: TreeDeciduous },
  { key: 'water', icon: Droplets },
  { key: 'parcels', icon: LandPlot },
];

export function LayersPanel() {
  const { t } = useTranslation('shell');
  const layers = useViewportStore((s) => s.layers);
  const setLayer = useViewportStore((s) => s.setLayer);
  const busy = useShellStore((s) => s.busy);
  return (
    <div className="lp-scroll">
      <section className="section">
        <h3 className="label">{t('layers.context')}</h3>
        <ul className="list">
          {LAYERS.map(({ key, icon: Icon }) => (
            <li key={key}>
              <label className="list-row layer-row">
                <span className={`layer-icon layer-${key}`}>
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                <span className="list-text">{t(`layers.${key}`)}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={layers[key]}
                  onChange={(e) => setLayer(key, e.target.checked)}
                  aria-label={t(`layers.${key}`)}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h3 className="label">{t('layers.basemap')}</h3>
        <Segmented
          ariaLabel={t('layers.basemap')}
          value={layers.basemap}
          onChange={(v) => setLayer('basemap', v)}
          options={[
            { value: 'none', label: t('layers.basemaps.none') },
            { value: 'plan', label: t('layers.basemaps.plan') },
            { value: 'ortho', label: t('layers.basemaps.ortho') },
          ]}
        />
      </section>
      <section className="section">
        <button
          type="button"
          className="btn btn-block"
          disabled={busy}
          onClick={() => void reloadContext()}
        >
          <RefreshCw size={15} strokeWidth={1.75} className={busy ? 'spin' : undefined} />
          {busy ? t('ribbon.loading') : t('ribbon.reloadContext')}
        </button>
      </section>
    </div>
  );
}

function ViewsTab() {
  const { t } = useTranslation('shell');
  const prep = t('common:inPreparation');
  const activeView = useUiStore((s) => s.activeView);
  const openView = useUiStore((s) => s.openView);
  const rows: { id: ViewId; label: string; icon: LucideIcon; on?: () => void }[] = (
    [
      ['3d', Cuboid],
      ['site', Frame],
      ['elevN', Columns3],
      ['elevE', Columns3],
      ['elevS', Columns3],
      ['elevW', Columns3],
      ['sectionA', ScanLine],
      ['sectionB', ScanLine],
      ['axoSW', Box],
      ['axoNE', Box],
      ['areas', Table2],
    ] as const
  ).map(([id, icon]) => ({ id, icon, label: t(`views.${id}`), on: () => openView(id) }));
  return (
    <div className="lp-scroll">
      <section className="section">
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`list-row${r.on && activeView === r.id ? ' is-active' : ''}`}
                disabled={!r.on}
                title={r.on ? undefined : prep}
                onClick={r.on}
              >
                <r.icon size={15} strokeWidth={1.75} className="muted-icon" />
                <span className="list-text">{r.label}</span>
                {!r.on && <span className="badge">{prep}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Collapsible left panel: project content, layers, views. */
export function LeftPanel() {
  const { t } = useTranslation('shell');
  const tab = useShellStore((s) => s.leftTab);
  const setTab = useShellStore((s) => s.setLeftTab);
  const setOpen = useShellStore((s) => s.setLeftOpen);
  return (
    <aside className="glass panel left-panel" aria-label={t('panel.label')}>
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as LeftTab)} className="lp-tabs">
        <div className="panel-head">
          <Tabs.List className="tabs" aria-label={t('panel.label')}>
            <Tabs.Trigger value="project" className="tab">
              {t('panel.project')}
            </Tabs.Trigger>
            <Tabs.Trigger value="layers" className="tab">
              {t('layers.title')}
            </Tabs.Trigger>
            <Tabs.Trigger value="views" className="tab">
              {t('browser.views')}
            </Tabs.Trigger>
          </Tabs.List>
          <IconButton
            icon={PanelLeftClose}
            label={t('panel.collapse')}
            size={16}
            onClick={() => setOpen(false)}
          />
        </div>
        <Tabs.Content value="project" className="lp-content">
          <ProjectTab />
        </Tabs.Content>
        <Tabs.Content value="layers" className="lp-content">
          <LayersPanel />
        </Tabs.Content>
        <Tabs.Content value="views" className="lp-content">
          <ViewsTab />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
