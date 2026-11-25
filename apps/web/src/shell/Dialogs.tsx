import {
  requiredFacade,
  resolveOutdoorRules,
  resolveUnitRules,
  type AccessType,
  type Constraints,
  type ModelWarning,
  type Project,
  type RuleProfileId,
  type Settings,
  type StoreyNotation,
  type UnitRules,
  type WarningCode,
} from '@kubatur/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { formatNumber, LANGUAGES, type Language } from '../i18n';
import { actions, activeVariant, useProjectStore } from '../store/projectStore';
import { useAnalysis } from '../store/useAnalysis';
import { useUiStore } from '../store/uiStore';
import { ACCESS_TYPES } from './PropertiesPalette';
import { useShellStore } from './shellStore';
import { IfcExportDialog } from '../exports/IfcExportDialog';
import { DossierDialog } from '../dossier/DossierDialog';
import { RenderDialog } from '../render/RenderDialog';
import { Dialog, NumField, Row } from './ui';

export function Dialogs() {
  const dialog = useShellStore((s) => s.dialog);
  const project = useProjectStore((s) => s.project);
  if (!dialog || !project) return null;
  switch (dialog) {
    case 'projectInfo':
      return <ProjectInfoDialog project={project} />;
    case 'settings':
      return <SettingsDialog project={project} />;
    case 'constraints':
      return <ConstraintsDialog project={project} />;
    case 'warnings':
      return <WarningsDialog />;
    case 'ifcExport':
      return <IfcExportDialog project={project} />;
    case 'dossier':
      return <DossierDialog project={project} />;
    case 'render':
      return <RenderDialog project={project} />;
  }
}

function close() {
  useShellStore.getState().setDialog(null);
}

function Footer({ onApply }: { onApply: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <button className="btn" onClick={close}>
        {t('common:actions.cancel')}
      </button>
      <button
        className="btn btn-primary"
        onClick={() => {
          onApply();
          close();
        }}
      >
        {t('common:actions.ok')}
      </button>
    </>
  );
}

const INFO_FIELDS = ['address', 'client', 'author', 'office', 'date', 'revision', 'phase'] as const;

function ProjectInfoDialog({ project }: { project: Project }) {
  const { t } = useTranslation('shell');
  const [name, setName] = useState(project.name);
  const [info, setInfo] = useState(project.info);
  return (
    <Dialog
      open
      title={t('file.projectInfo')}
      onClose={close}
      footer={
        <Footer
          onApply={() =>
            actions.updateInfo((p) => {
              p.name = name;
              p.info = { ...info };
            })
          }
        />
      }
    >
      <Row label={t('info.name')}>
        <input aria-label={t('info.name')} value={name} onChange={(e) => setName(e.target.value)} />
      </Row>
      {INFO_FIELDS.map((k) => (
        <Row key={k} label={t(`info.${k}`)}>
          <input
            aria-label={t(`info.${k}`)}
            value={info[k] ?? ''}
            onChange={(e) => setInfo({ ...info, [k]: e.target.value })}
          />
        </Row>
      ))}
      <Row label={t('info.crs')}>
        <span>{project.geo.crs}</span>
      </Row>
    </Dialog>
  );
}

function SettingsDialog({ project }: { project: Project }) {
  const { t } = useTranslation('shell');
  const [s, setS] = useState<Settings>(project.settings);
  const patch = (f: (d: Settings) => Settings) => setS((prev) => f(prev));
  const num = (
    label: string,
    value: number,
    set: (v: number) => void,
    o: { suffix?: string; digits?: number } = {},
  ) => (
    <Row label={label}>
      <NumField
        ariaLabel={label}
        value={value}
        onCommit={set}
        min={0}
        suffix={o.suffix}
        digits={o.digits}
      />
    </Row>
  );
  const pct = (v: number) => v * 100;
  const rules = resolveUnitRules(s);
  const setRule = (k: Exclude<keyof UnitRules, 'minAreas'>, v: number | boolean) =>
    patch((d) => ({ ...d, unitRules: { ...resolveUnitRules(d), [k]: v } }));
  const facadeList = s.unitMix
    .map((u) => `${u.label} ${formatNumber(requiredFacade(u, rules))} m`)
    .join(' · ');
  return (
    <Dialog
      open
      wide
      title={t('file.settings')}
      onClose={close}
      footer={
        <Footer
          onApply={() => {
            actions.updateSettings((d) => {
              Object.assign(d, s);
            });
            if (s.language !== i18n.language) void i18n.changeLanguage(s.language);
          }}
        />
      }
    >
      <div className="dlg-cols">
        <div>
          <h3>{t('settings.general')}</h3>
          <Row label={t('settings.profile')}>
            <select
              aria-label={t('settings.profile')}
              value={s.profile}
              onChange={(e) => patch((d) => ({ ...d, profile: e.target.value as RuleProfileId }))}
            >
              {(['FR', 'DE'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`settings.profiles.${p}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.notation')}>
            <select
              aria-label={t('settings.notation')}
              value={s.notation}
              onChange={(e) => patch((d) => ({ ...d, notation: e.target.value as StoreyNotation }))}
            >
              {(['fr', 'de', 'roman'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`settings.notations.${p}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.language')}>
            <select
              aria-label={t('settings.language')}
              value={s.language}
              onChange={(e) => patch((d) => ({ ...d, language: e.target.value as Language }))}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`settings.languages.${l}`)}
                </option>
              ))}
            </select>
          </Row>
          <h3>{t('settings.ratios')}</h3>
          {num(
            t('settings.wallThickness'),
            s.areas.exteriorWallThickness,
            (v) => patch((d) => ({ ...d, areas: { ...d.areas, exteriorWallThickness: v } })),
            { suffix: 'm' },
          )}
          {num(
            t('settings.technicalShare'),
            pct(s.areas.technicalShare),
            (v) => patch((d) => ({ ...d, areas: { ...d.areas, technicalShare: v / 100 } })),
            { suffix: '%', digits: 1 },
          )}
          {num(
            t('settings.interiorShare'),
            pct(s.areas.interiorConstructionShare),
            (v) =>
              patch((d) => ({ ...d, areas: { ...d.areas, interiorConstructionShare: v / 100 } })),
            { suffix: '%', digits: 1 },
          )}
          {num(
            t('settings.parkingArea'),
            s.parking.garageAreaPerSpace,
            (v) => patch((d) => ({ ...d, parking: { ...d.parking, garageAreaPerSpace: v } })),
            { suffix: 'm²' },
          )}
          {num(t('settings.parkingPerDwelling'), s.parking.perDwelling, (v) =>
            patch((d) => ({ ...d, parking: { ...d.parking, perDwelling: v } })),
          )}
          {num(
            t('settings.workplaceArea'),
            s.workplaceArea,
            (v) => patch((d) => ({ ...d, workplaceArea: v })),
            { suffix: 'm²' },
          )}
        </div>
        <div>
          <h3>{t('settings.circulation')}</h3>
          {ACCESS_TYPES.map((a: AccessType) =>
            num(
              t(`common:access.${a}`),
              pct(s.areas.circulationShare[a]),
              (v) =>
                patch((d) => ({
                  ...d,
                  areas: {
                    ...d.areas,
                    circulationShare: { ...d.areas.circulationShare, [a]: v / 100 },
                  },
                })),
              { suffix: '%', digits: 1 },
            ),
          )}
          <h3>{t('settings.unitRules')}</h3>
          {(
            ['livingMinFacade', 'pmrBedroomMinFacade', 'bedroomMinFacade', 'interiorWall'] as const
          ).map((k) => (
            <div key={k}>
              {num(t(`settings.${k}`), rules[k], (v) => setRule(k, v), {
                suffix: 'm',
                digits: 2,
              })}
            </div>
          ))}
          <Row label={t('settings.galleryCountsAsFacade')}>
            <input
              type="checkbox"
              aria-label={t('settings.galleryCountsAsFacade')}
              checked={rules.galleryCountsAsFacade}
              onChange={(e) => setRule('galleryCountsAsFacade', e.target.checked)}
            />
          </Row>
          {num(
            t('settings.kitchenMinFacade'),
            rules.kitchenMinFacade,
            (v) => setRule('kitchenMinFacade', v),
            {
              suffix: 'm',
              digits: 2,
            },
          )}
          <Row label={t('settings.separateKitchen')}>
            <input
              type="checkbox"
              aria-label={t('settings.separateKitchen')}
              checked={rules.separateKitchen}
              onChange={(e) => setRule('separateKitchen', e.target.checked)}
            />
          </Row>
          {num(
            t('settings.facadeAreaRatio'),
            rules.facadeAreaRatio * 100,
            (v) => setRule('facadeAreaRatio', v / 100),
            { suffix: '%', digits: 0 },
          )}
          {num(t('settings.facadeGrid'), rules.facadeGrid, (v) => setRule('facadeGrid', v), {
            suffix: 'm',
            digits: 2,
          })}
          {num(t('settings.shaftSize'), rules.shaftSize, (v) => setRule('shaftSize', v), {
            suffix: 'm',
            digits: 2,
          })}
          {(['unitsPerCoreMin', 'unitsPerCoreMax'] as const).map((k) => (
            <div key={k}>
              {num(t(`settings.${k}`), rules[k], (v) => setRule(k, Math.max(1, Math.round(v))), {
                digits: 0,
              })}
            </div>
          ))}
          <h4>{t('settings.minAreas')}</h4>
          {(
            [
              'sejour',
              'sejourCuisine',
              'cuisine',
              'chambre',
              'chambrePmr',
              'sdb',
              'sde',
              'wc',
            ] as const
          ).map((k) => (
            <div key={k}>
              {num(
                t(`settings.minArea.${k}`),
                rules.minAreas[k],
                (v) =>
                  patch((d) => {
                    const r = resolveUnitRules(d);
                    return { ...d, unitRules: { ...r, minAreas: { ...r.minAreas, [k]: v } } };
                  }),
                { suffix: 'm²', digits: 1 },
              )}
            </div>
          ))}
          <p className="muted">{t('settings.unitRulesNote', { list: facadeList })}</p>
          <h3>{t('outdoor.rules')}</h3>
          {(
            [
              ['minArea', 'm²'],
              ['loggiaMinDepth', 'm'],
              ['balconMinDepth', 'm'],
              ['terraceDepth', 'm'],
            ] as const
          ).map(([k, suffix]) => (
            <div key={k}>
              {num(
                t(`outdoor.${k}`),
                resolveOutdoorRules(s)[k],
                (v) =>
                  patch((d) => ({ ...d, outdoorRules: { ...resolveOutdoorRules(d), [k]: v } })),
                { suffix, digits: 2 },
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function ConstraintsDialog({ project }: { project: Project }) {
  const { t } = useTranslation('shell');
  const [c, setC] = useState<Constraints>(project.constraints);
  const de = project.settings.profile === 'DE';
  const field = (
    key: keyof Constraints,
    label: string,
    o: { factor?: number; suffix?: string; integer?: boolean } = {},
  ) => {
    const factor = o.factor ?? 1;
    const raw = c[key] as number | undefined;
    return (
      <Row label={label}>
        <span className="row-inline">
          <NumField
            ariaLabel={label}
            value={raw === undefined ? null : raw * factor}
            placeholder="—"
            integer={o.integer}
            min={0}
            suffix={o.suffix}
            onCommit={(v) => setC({ ...c, [key]: v / factor })}
          />
          {raw !== undefined && (
            <button
              className="btn btn-small"
              onClick={() => {
                const next = { ...c };
                delete next[key];
                setC(next);
              }}
            >
              {t('rules.clear')}
            </button>
          )}
        </span>
      </Row>
    );
  };
  return (
    <Dialog
      open
      title={t('ribbon.constraints')}
      onClose={close}
      footer={<Footer onApply={() => actions.setConstraints(c)} />}
    >
      <h3>{t('rules.fr')}</h3>
      {field('empriseMax', t('rules.empriseMax'), { factor: 100, suffix: '%' })}
      {field('hauteurMax', t('rules.hauteurMax'), { suffix: 'm' })}
      {field('espacesVertsMin', t('rules.espacesVertsMin'), { factor: 100, suffix: '%' })}
      {field('pleineTerreMin', t('rules.pleineTerreMin'), { factor: 100, suffix: '%' })}
      {de && (
        <>
          <h3>{t('rules.de')}</h3>
          {field('grz', t('common:kpi.grz'))}
          {field('gfz', t('common:kpi.gfz'))}
          {field('bmz', t('common:kpi.bmz'))}
          {field('maxFullStoreys', t('common:kpi.maxFullStoreys'), { integer: true })}
          {field('maxHeight', t('common:kpi.totalHeight'), { suffix: 'm' })}
        </>
      )}
      <p className="muted">{t('rules.note')}</p>
    </Dialog>
  );
}

export const WARNING_CODES: WarningCode[] = [
  'massOverlap',
  'outsideSite',
  'outsideBuildable',
  'constraintExceeded',
  'constraintBelow',
  'depthOutOfRange',
  'lightDepth',
  'mixPlausibility',
  'estimatedContextHeights',
  'unitFacade',
];

/** Translated message for a model warning (numbers formatted for the UI language). */
export function warningMessage(w: ModelWarning, names: Record<string, string>): string {
  const lng = i18n.language;
  const data: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(w.data ?? {})) {
    const integer = ['count', 'min', 'max'].includes(k) || w.code === 'mixPlausibility';
    data[k] = typeof v === 'number' ? formatNumber(v, integer ? 0 : 2, lng) : v;
  }
  if (
    (w.code === 'constraintExceeded' || w.code === 'constraintBelow') &&
    typeof w.data?.key === 'string'
  )
    data.key = i18n.t(`common:kpi.${w.data.key}`);
  data.masses = w.massIds.map((id) => names[id] ?? id).join(', ');
  return i18n.t(`shell:warnings.${w.code}`, data);
}

function WarningsDialog() {
  const { t } = useTranslation('shell');
  const analysis = useAnalysis();
  const project = useProjectStore((s) => s.project)!;
  const setSelection = useUiStore((s) => s.setSelection);
  const names = Object.fromEntries(activeVariant(project).masses.map((m) => [m.id, m.name]));
  const warnings = analysis?.warnings ?? [];
  return (
    <Dialog open wide title={t('ribbon.warnings')} onClose={close}>
      {warnings.length === 0 ? (
        <p className="muted">{t('warnings.none')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('warnings.severity')}</th>
              <th>{t('warnings.message')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {warnings.map((w, i) => (
              <tr key={i}>
                <td>
                  <span className={`sev sev-${w.severity}`}>{t(`warnings.sev.${w.severity}`)}</span>
                </td>
                <td>{warningMessage(w, names)}</td>
                <td>
                  {w.massIds.length > 0 && (
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        setSelection(w.massIds);
                        close();
                      }}
                    >
                      {t('warnings.select')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
