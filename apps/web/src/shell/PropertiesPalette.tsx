import {
  massFootprints,
  polygonArea,
  polygonsArea,
  storeyLabel,
  USAGES,
  type AccessType,
  type ContextBuilding,
  type Mass,
  type MassResult,
  type StoreyStack,
  type Usage,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { actions, activeVariant, useProjectStore } from '../store/projectStore';
import { STYLES, type VisualStyle } from '../store/tools';
import { useAnalysis } from '../store/useAnalysis';
import { useUiStore } from '../store/uiStore';
import { useViewportStore } from '../viewport/viewportStore';
import { SCENE_LOOKS, type SceneLook } from '../viewport/scene/looks';
import { DuplexFields } from './DuplexFields';
import { OutdoorFields } from './OutdoorFields';
import { PlantingProperties, RoofFields, TerraceFields } from './MassShapeFields';
import { TypologyInputs } from './TypologyInputs';
import { useShellStore } from './shellStore';
import { Group, NumField, Row, Segmented, TrafficDot } from './ui';

export const ACCESS_TYPES: AccessType[] = [
  'zweispaenner',
  'dreispaenner',
  'laubengang',
  'mittelflur',
  'punkthaus',
  'reihenhaus',
  'buero',
];

const RAD = 180 / Math.PI;

export function PropertiesPalette() {
  const { t } = useTranslation('shell');
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  if (!project) {
    return (
      <div className="palette">
        <div className="palette-empty">{t('props.noProject')}</div>
      </div>
    );
  }
  const masses = activeVariant(project).masses.filter((m) => selection.includes(m.id));
  const ctx = project.context.filter((c) => selection.includes(c.id));
  const zones = (activeVariant(project).plantings ?? []).filter((z) => selection.includes(z.id));
  let body;
  let type: string;
  let title: string;
  if (masses.length === 1) {
    body = <MassProperties mass={masses[0]!} />;
    title = masses[0]!.name;
    type = t(`common:typology.${masses[0]!.typology.kind}`);
  } else if (masses.length > 1) {
    body = <MultiMassProperties masses={masses} />;
    title = t('props.multi', { count: masses.length });
    type = t('props.title');
  } else if (zones.length === 1) {
    body = <PlantingProperties zone={zones[0]!} />;
    title = zones[0]!.name;
    type = t('green.title');
  } else if (ctx.length === 1) {
    body = <ContextProperties c={ctx[0]!} />;
    title = t('props.contextBuilding');
    type = t('props.group.context');
  } else {
    body = <ViewProperties />;
    title = project.name;
    type = t('inspector.noSelection');
  }
  return (
    <div className="palette">
      <div className="palette-type">
        <span className="palette-kicker">{type}</span>
        <span className="palette-title">{title}</span>
      </div>
      <div className="palette-body">{body}</div>
    </div>
  );
}

function useMassResult(id: string): MassResult | undefined {
  const analysis = useAnalysis();
  return analysis?.result.masses.find((m) => m.mass.id === id);
}

function StoreyFields(props: {
  get: (f: (s: StoreyStack) => number) => number | null;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t } = useTranslation('shell');
  const g = props.get;
  const u = props.update;
  const num = (
    key: string,
    get: (s: StoreyStack) => number,
    set: (s: Draft<StoreyStack>, v: number) => void,
    o: { integer?: boolean; min?: number; suffix?: string } = {},
  ) => (
    <Row label={t(`props.storeys.${key}`)}>
      <NumField
        ariaLabel={t(`props.storeys.${key}`)}
        value={g(get)}
        placeholder={t('props.mixed')}
        integer={o.integer}
        min={o.min ?? 0}
        suffix={o.suffix}
        onCommit={(v) => u((m) => set(m.storeys, v))}
      />
    </Row>
  );
  return (
    <Group title={t('props.group.storeys')}>
      {num(
        'basementCount',
        (s) => s.basement.count,
        (s, v) => void (s.basement.count = v),
        { integer: true },
      )}
      {num(
        'basementHeight',
        (s) => s.basement.height,
        (s, v) => void (s.basement.height = v),
        { min: 2, suffix: 'm' },
      )}
      {num(
        'groundHeight',
        (s) => s.ground.height,
        (s, v) => void (s.ground.height = v),
        { min: 2, suffix: 'm' },
      )}
      {num(
        'upperCount',
        (s) => s.upper.count,
        (s, v) => void (s.upper.count = v),
        { integer: true },
      )}
      {num(
        'upperHeight',
        (s) => s.upper.height,
        (s, v) => void (s.upper.height = v),
        { min: 2, suffix: 'm' },
      )}
      {num(
        'setbackCount',
        (s) => s.setback?.storeys ?? 0,
        (s, v) => {
          if (v <= 0) delete s.setback;
          else s.setback = { storeys: v, distance: s.setback?.distance ?? 2 };
        },
        { integer: true },
      )}
      {num(
        'setbackDistance',
        (s) =>
          typeof s.setback?.distance === 'number'
            ? s.setback.distance
            : (s.setback?.distance.front ?? 0),
        (s, v) => {
          s.setback = { storeys: s.setback?.storeys ?? 1, distance: v };
        },
        { suffix: 'm' },
      )}
      {num(
        'parapet',
        (s) => s.parapet,
        (s, v) => void (s.parapet = v),
        { suffix: 'm' },
      )}
      {num(
        'slab',
        (s) => s.slabThickness,
        (s, v) => void (s.slabThickness = v),
        { suffix: 'm' },
      )}
    </Group>
  );
}

function MassProperties({ mass }: { mass: Mass }) {
  const { t, i18n } = useTranslation('shell');
  const project = useProjectStore((s) => s.project)!;
  const res = useMassResult(mass.id);
  const update = (recipe: (m: Draft<Mass>) => void) => actions.updateMass(mass.id, recipe);
  const notation = project.settings.notation;
  const indices: number[] = [];
  for (let i = -mass.storeys.basement.count; i <= mass.storeys.upper.count; i++) indices.push(i);
  const sbCount = mass.storeys.setback?.storeys ?? 0;
  const n = (v: number, d = 2) => formatNumber(v, d, i18n.language);

  return (
    <>
      <Group title={t('props.group.identity')}>
        <Row label={t('props.name')}>
          <input
            aria-label={t('props.name')}
            defaultValue={mass.name}
            key={mass.id + mass.name}
            onBlur={(e) =>
              e.target.value !== mass.name && update((m) => void (m.name = e.target.value))
            }
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Row>
      </Group>
      <Group title={t('props.group.dimensions')}>
        <TypologyInputs
          className="prow"
          typology={mass.typology}
          onChange={(recipe) => update((m) => recipe(m.typology))}
        />
        {mass.typology.kind === 'freePolygon' && (
          <Row label={t('props.area')}>
            <span>{n(polygonArea(mass.typology.polygon))} m²</span>
          </Row>
        )}
      </Group>
      <Group title={t('props.group.position')}>
        <Row label="X">
          <NumField
            ariaLabel="X"
            value={mass.position[0]}
            suffix="m"
            onCommit={(v) => update((m) => void (m.position[0] = v))}
          />
        </Row>
        <Row label="Y">
          <NumField
            ariaLabel="Y"
            value={mass.position[1]}
            suffix="m"
            onCommit={(v) => update((m) => void (m.position[1] = v))}
          />
        </Row>
        <Row label={t('props.rotation')}>
          <NumField
            ariaLabel={t('props.rotation')}
            value={mass.rotation * RAD}
            digits={1}
            suffix="°"
            onCommit={(v) => update((m) => void (m.rotation = v / RAD))}
          />
        </Row>
      </Group>
      <StoreyFields get={(f) => f(mass.storeys)} update={update} />
      <TerraceFields mass={mass} update={update} />
      <RoofFields mass={mass} update={update} />
      <Group title={t('props.group.usage')}>
        <Row label={t('props.usage')}>
          <select
            aria-label={t('props.usage')}
            value={mass.usage ?? 'wohnen'}
            onChange={(e) => update((m) => void (m.usage = e.target.value as Usage))}
          >
            {USAGES.map((u) => (
              <option key={u} value={u}>
                {t(`common:usage.${u}`)}
              </option>
            ))}
          </select>
        </Row>
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            update((m) => {
              m.usage = 'wohnen';
              m.usageByStorey = { 0: 'gewerbe' };
            })
          }
        >
          {t('props.presetRetail')}
        </button>
        {indices.map((i) => {
          const label = storeyLabel(
            i,
            notation,
            i > mass.storeys.upper.count - sbCount && i > 0,
            mass.storeys.basement.count,
          );
          return (
            <Row key={i} label={label}>
              <select
                aria-label={label}
                value={mass.usageByStorey?.[i] ?? ''}
                onChange={(e) =>
                  update((m) => {
                    const v = e.target.value as Usage | '';
                    m.usageByStorey ??= {};
                    if (v) m.usageByStorey[i] = v;
                    else delete m.usageByStorey[i];
                  })
                }
              >
                <option value="">{t('props.defaultUsage')}</option>
                {USAGES.map((u) => (
                  <option key={u} value={u}>
                    {t(`common:usage.${u}`)}
                  </option>
                ))}
              </select>
            </Row>
          );
        })}
        <Row label={t('props.access')}>
          <select
            aria-label={t('props.access')}
            value={mass.access ?? 'auto'}
            onChange={(e) => update((m) => void (m.access = e.target.value as AccessType | 'auto'))}
          >
            <option value="auto">{t('common:access.auto')}</option>
            {ACCESS_TYPES.map((a) => (
              <option key={a} value={a}>
                {t(`common:access.${a}`)}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      {(mass.usage ?? 'wohnen') === 'wohnen' && (
        <>
          <OutdoorFields mass={mass} settings={project.settings} update={update} />
          <DuplexFields mass={mass} settings={project.settings} update={update} />
        </>
      )}
      {res && (
        <Group title={t('props.group.results')}>
          <Row label={t('common:kpi.emprise')}>
            <span>{n(polygonsArea(massFootprints(mass)), 0)} m²</span>
          </Row>
          <Row label={t('props.bgf')}>
            <span>{n(res.areas.bgf, 0)} m²</span>
          </Row>
          <Row label={t('common:kpi.niveaux')}>
            <span>{res.formula}</span>
          </Row>
          <Row label={t('common:kpi.hauteur')}>
            <span>{n(res.totalHeight)} m</span>
          </Row>
          <Row label={t('common:kpi.logements')}>
            <span>{res.dwellings.total}</span>
          </Row>
          <Row label={t('props.depth')}>
            <span>{n(res.depth)} m</span>
          </Row>
          <Row label={t('props.resolvedAccess')}>
            <span>{t(`common:access.${res.access}`)}</span>
          </Row>
          {res.suitability.map((s) => (
            <Row key={s.type} label={t(`props.suitability.${s.type}`)}>
              <span className="suit">
                <TrafficDot status={s.status} />
                {s.range && `${n(s.range[0], 0)}–${n(s.range[1], 0)} m`}
              </span>
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}

function MultiMassProperties({ masses }: { masses: Mass[] }) {
  const { t } = useTranslation('shell');
  const ids = masses.map((m) => m.id);
  const update = (recipe: (m: Draft<Mass>) => void) => actions.updateMasses(ids, recipe);
  const shared = (f: (s: StoreyStack) => number): number | null => {
    const v = f(masses[0]!.storeys);
    return masses.every((m) => Math.abs(f(m.storeys) - v) < 1e-9) ? v : null;
  };
  const usage = masses.every((m) => (m.usage ?? 'wohnen') === (masses[0]!.usage ?? 'wohnen'))
    ? (masses[0]!.usage ?? 'wohnen')
    : '';
  return (
    <>
      <StoreyFields get={shared} update={update} />
      <Group title={t('props.group.usage')}>
        <Row label={t('props.usage')}>
          <select
            aria-label={t('props.usage')}
            value={usage}
            onChange={(e) =>
              e.target.value && update((m) => void (m.usage = e.target.value as Usage))
            }
          >
            {!usage && <option value="">{t('props.mixed')}</option>}
            {USAGES.map((u) => (
              <option key={u} value={u}>
                {t(`common:usage.${u}`)}
              </option>
            ))}
          </select>
        </Row>
      </Group>
    </>
  );
}

function ContextProperties({ c }: { c: ContextBuilding }) {
  const { t } = useTranslation('shell');
  const update = (recipe: (c: Draft<ContextBuilding>) => void) =>
    actions.updateContextBuilding(c.id, recipe);
  return (
    <Group title={t('props.group.context')}>
      <Row label={t('props.height')}>
        <NumField
          ariaLabel={t('props.height')}
          value={c.height}
          min={0}
          suffix="m"
          onCommit={(v) =>
            update((d) => {
              d.height = v;
              d.heightEstimated = false;
            })
          }
        />
      </Row>
      <Row label={t('props.levels')}>
        <NumField
          ariaLabel={t('props.levels')}
          value={c.levels ?? null}
          integer
          min={0}
          onCommit={(v) => update((d) => void (d.levels = v))}
        />
      </Row>
      <Row label={t('props.estimated')}>
        <span>{c.heightEstimated ? t('props.yes') : t('props.no')}</span>
      </Row>
      <Row label={t('props.hidden')}>
        <input
          type="checkbox"
          aria-label={t('props.hidden')}
          checked={!!c.hidden}
          onChange={(e) => update((d) => void (d.hidden = e.target.checked))}
        />
      </Row>
      <Row label={t('props.demolished')}>
        <input
          type="checkbox"
          aria-label={t('props.demolished')}
          checked={!!c.demolished}
          onChange={(e) => update((d) => void (d.demolished = e.target.checked))}
        />
      </Row>
      <Row label={t('props.source')}>
        <span>{c.source.toUpperCase()}</span>
      </Row>
    </Group>
  );
}

function ViewProperties() {
  const { t, i18n } = useTranslation('shell');
  const project = useProjectStore((s) => s.project)!;
  const style = useUiStore((s) => s.visualStyle);
  const setStyle = useUiStore((s) => s.setVisualStyle);
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  // the plan view is always parallel, seen from above
  const plan = useUiStore((s) => s.activeView === 'plan');
  const look = useViewportStore((s) => s.look);
  const setLook = useViewportStore((s) => s.setLook);
  const setDialog = useShellStore((s) => s.setDialog);
  const n = (v: number, d = 0) => formatNumber(v, d, i18n.language);
  const siteArea = polygonsArea(project.site.parcels.map((p) => p.polygon));
  const c = project.constraints;
  const fr = project.settings.profile === 'FR';
  const rules: [string, string][] = fr
    ? [
        [t('rules.empriseMax'), c.empriseMax != null ? `${n(c.empriseMax * 100, 0)} %` : '—'],
        [t('rules.hauteurMax'), c.hauteurMax != null ? `${n(c.hauteurMax, 1)} m` : '—'],
      ]
    : [
        ['GRZ', c.grz != null ? n(c.grz, 2) : '—'],
        ['GFZ', c.gfz != null ? n(c.gfz, 2) : '—'],
        [t('rules.hauteurMax'), c.maxHeight != null ? `${n(c.maxHeight, 1)} m` : '—'],
      ];
  return (
    <>
      <Group title={t('inspector.site')}>
        <Row label={t('info.address')}>
          <span className="ro">{project.info.address ?? '—'}</span>
        </Row>
        <Row label={t('panel.parcels')}>
          <span className="ro">
            {project.site.parcels.map((p) => p.ref ?? p.id).join(', ') || '—'}
          </span>
        </Row>
        <Row label={t('inspector.siteArea')}>
          <span className="ro num">{n(siteArea)} m²</span>
        </Row>
        <Row label={t('settings.profile')}>
          <span className="ro">{t(`settings.profiles.${project.settings.profile}`)}</span>
        </Row>
      </Group>
      <Group title={t('inspector.constraints')}>
        {rules.map(([k, v]) => (
          <Row key={k} label={k}>
            <span className="ro num">{v}</span>
          </Row>
        ))}
        <button
          type="button"
          className="btn btn-sm btn-block"
          onClick={() => setDialog('constraints')}
        >
          {t('inspector.editRules')}
        </button>
      </Group>
      <Group title={t('props.group.graphics')}>
        <Row label={t('view.style')}>
          <select value={style} onChange={(e) => setStyle(e.target.value as VisualStyle)}>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`view.styles.${s}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('view.look')}>
          <select value={look} onChange={(e) => setLook(e.target.value as SceneLook)}>
            {SCENE_LOOKS.map((l) => (
              <option key={l} value={l}>
                {t(`view.looks.${l}`)}
              </option>
            ))}
          </select>
        </Row>
        {!plan && (
          <Row label={t('view.projection')}>
            <Segmented
              ariaLabel={t('view.projection')}
              value={projection}
              onChange={setProjection}
              options={[
                { value: 'perspective', label: t('viewport:bar.persp') },
                { value: 'orthographic', label: t('viewport:bar.ortho') },
              ]}
            />
          </Row>
        )}
      </Group>
      <Group title={t('props.group.project')}>
        <Row label={t('info.crs')}>
          <span className="ro">{project.geo.crs}</span>
        </Row>
        <Row label={t('info.phase')}>
          <span className="ro">{project.info.phase || '—'}</span>
        </Row>
      </Group>
    </>
  );
}
