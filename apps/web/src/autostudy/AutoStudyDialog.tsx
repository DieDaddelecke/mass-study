import {
  AUTO_FAMILIES,
  AUTO_USAGES,
  autoEnvelope,
  autoRulesFromConstraints,
  constraintsWithAutoRules,
  defaultAutoOptions,
  massFootprints,
  newId,
  runAutoStudy,
  siteBoundaries,
  type AutoFamily,
  type AutoScenario,
  type AutoStudyOptions,
  type AutoStudyRules,
  type AutoUsage,
  type BoundarySegment,
  type Polygon,
  type Project,
  type Vec2,
} from '@kubatur/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { actions, useProjectStore } from '../store/projectStore';
import { useShellStore } from '../shell/shellStore';
import { Dialog, NumField, Row } from '../shell/ui';
import './autostudy.css';

const STORAGE_KEY = 'kubatur.autostudy';

interface Stored {
  usages: AutoUsage[];
  families: AutoFamily[];
  maxBuildings: number;
  options: Record<AutoUsage, Pick<AutoStudyOptions, 'depth' | 'pointSide'>>;
}

function defaults(): Stored {
  const options = Object.fromEntries(
    AUTO_USAGES.map((u) => {
      const o = defaultAutoOptions(u);
      return [u, { depth: o.depth, pointSide: o.pointSide }];
    }),
  ) as Stored['options'];
  return { usages: ['wohnen'], families: [...AUTO_FAMILIES], maxBuildings: 3, options };
}

function loadStored(): Stored {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Stored>;
      return { ...base, ...p, options: { ...base.options, ...p.options } };
    }
  } catch {
    /* storage unavailable */
  }
  return base;
}

function saveStored(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** One row per boundary edge (pieces of the same edge share the key). */
interface EdgeRow {
  key: string;
  n: number;
  kind: BoundarySegment['kind'];
  length: number;
  segs: BoundarySegment[];
}

function edgeRows(segs: readonly BoundarySegment[]): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const s of segs) {
    const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const row = rows.find((r) => r.key === s.key);
    if (row) {
      row.segs.push(s);
      row.length += l;
    } else rows.push({ key: s.key, n: rows.length + 1, kind: s.kind, length: l, segs: [s] });
  }
  // the kind of the longest piece names the edge
  for (const r of rows) {
    const len = new Map<string, number>();
    for (const s of r.segs)
      len.set(s.kind, (len.get(s.kind) ?? 0) + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]));
    r.kind = [...len.entries()].sort((a, b) => b[1] - a[1])[0]![0] as EdgeRow['kind'];
  }
  return rows;
}

const isStreet = (k: string) => k === 'road' || k === 'path' || k === 'public';

/** "Étude automatique": rules → envelope per height → best building forms per use. */
export function AutoStudyDialog({ project }: { project: Project }) {
  const { t, i18n } = useTranslation('shell');
  const lng = i18n.language;
  const [rules, setRules] = useState<AutoStudyRules>(() =>
    autoRulesFromConstraints(project.constraints),
  );
  const [stored, setStored] = useState<Stored>(loadStored);
  const [results, setResults] = useState<{ usage: AutoUsage; scenarios: AutoScenario[] }[]>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Record<string, boolean>>({});

  const segs = useMemo(
    () => siteBoundaries(project.site, project.surroundings, project.context),
    [project.site, project.surroundings, project.context],
  );
  const rows = useMemo(() => edgeRows(segs), [segs]);
  const buildable = project.constraints.buildable ?? project.site.buildable;
  const envelope = useMemo(
    () => autoEnvelope(project.site.boundary, segs, rules, 0, buildable),
    [project.site.boundary, segs, rules, buildable],
  );

  const update = (s: Stored) => {
    setStored(s);
    saveStored(s);
  };
  const setRule = <K extends keyof AutoStudyRules>(k: K, v: AutoStudyRules[K] | undefined) => {
    setRules((r) => {
      const next = { ...r };
      if (v === undefined) delete next[k];
      else next[k] = v;
      return next;
    });
  };

  const run = () => {
    setBusy(true);
    actions.setConstraints(constraintsWithAutoRules(project.constraints, rules));
    // let the spinner paint before the (synchronous) study runs
    window.setTimeout(() => {
      try {
        const out = stored.usages.map((usage) => ({
          usage,
          scenarios: runAutoStudy({
            boundary: project.site.boundary,
            edges: segs,
            ...(buildable ? { buildable } : {}),
            rules,
            options: {
              ...defaultAutoOptions(usage),
              ...stored.options[usage],
              families: stored.families,
              maxBuildings: stored.maxBuildings,
            },
            settings: project.settings,
          }).scenarios,
        }));
        setResults(out);
        setCreated({});
      } catch (e) {
        useShellStore.getState().setError(String(e));
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const adopt = (s: AutoScenario) => {
    const name = `Auto · ${t(`auto.family.${s.family}`)} · ${t(`common:usage.${s.usage}`)} R+${s.levels - 1}`;
    const id = newId('var');
    useProjectStore.getState().update((p) => {
      p.variants.push({ id, name, masses: structuredClone(s.masses) });
      p.activeVariantId = id;
    });
    setCreated((c) => ({ ...c, [s.id]: true }));
    useShellStore.getState().setInfo(t('auto.created', { name }));
  };

  const num = (
    label: string,
    value: number | undefined,
    set: (v: number | undefined) => void,
    o: { suffix?: string; factor?: number; integer?: boolean; optional?: boolean } = {},
  ) => {
    const f = o.factor ?? 1;
    return (
      <Row label={label}>
        <span className="row-inline">
          <NumField
            ariaLabel={label}
            value={value === undefined ? null : value * f}
            placeholder="—"
            min={0}
            integer={o.integer}
            suffix={o.suffix}
            onCommit={(v) => set(v / f)}
          />
          {o.optional && value !== undefined && (
            <button className="btn btn-small" onClick={() => set(undefined)}>
              {t('rules.clear')}
            </button>
          )}
        </span>
      </Row>
    );
  };

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <Dialog
      open
      wide
      title={t('auto.title')}
      onClose={() => useShellStore.getState().setDialog(null)}
    >
      <div className="auto-grid">
        <div className="auto-rules">
          <p className="muted auto-intro">{t('auto.intro')}</p>
          <h3>{t('auto.use')}</h3>
          <div className="auto-chips">
            {AUTO_USAGES.map((u) => (
              <label key={u} className="auto-chip">
                <input
                  type="checkbox"
                  checked={stored.usages.includes(u)}
                  onChange={() => update({ ...stored, usages: toggle(stored.usages, u) })}
                />
                {t(`common:usage.${u}`)}
              </label>
            ))}
          </div>

          <h3>{t('auto.height')}</h3>
          {num(t('rules.hauteurMax'), rules.hauteurMax, (v) => setRule('hauteurMax', v), {
            suffix: 'm',
            optional: true,
          })}
          {num(t('auto.niveauxMax'), rules.niveauxMax, (v) => setRule('niveauxMax', v), {
            integer: true,
            optional: true,
          })}
          {num(t('rules.empriseMax'), rules.empriseMax, (v) => setRule('empriseMax', v), {
            suffix: '%',
            factor: 100,
            optional: true,
          })}
          {num(
            t('rules.pleineTerreMin'),
            rules.pleineTerreMin,
            (v) => setRule('pleineTerreMin', v),
            { suffix: '%', factor: 100, optional: true },
          )}

          <h3>{t('auto.distances')}</h3>
          {num(t('auto.reculVoie'), rules.reculVoie, (v) => setRule('reculVoie', v ?? 0), {
            suffix: 'm',
          })}
          {num(t('auto.prospectRatio'), rules.prospectRatio, (v) =>
            setRule('prospectRatio', v ?? 0),
          )}
          {num(t('auto.prospectMin'), rules.prospectMin, (v) => setRule('prospectMin', v ?? 0), {
            suffix: 'm',
          })}
          {num(t('auto.distanceRatio'), rules.distanceRatio, (v) =>
            setRule('distanceRatio', v ?? 0),
          )}
          {num(t('auto.distanceMin'), rules.distanceMin, (v) => setRule('distanceMin', v ?? 0), {
            suffix: 'm',
          })}

          <h3>{t('auto.edges')}</h3>
          <SitePlan
            boundary={project.site.boundary}
            envelope={envelope}
            rows={rows}
            footprints={[]}
          />
          <table className="table auto-edges">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className={`auto-edge-dot ${isStreet(r.kind) ? 'street' : 'nb'}`} />
                    {r.n}
                  </td>
                  <td>{t(`boundary.short.${r.kind}`)}</td>
                  <td className="num">{formatNumber(r.length, 0, lng)} m</td>
                  <td>
                    <NumField
                      ariaLabel={t('auto.edgeRecul', { n: r.n })}
                      value={rules.edgeRecul?.[r.key] ?? null}
                      placeholder={
                        isStreet(r.kind)
                          ? formatNumber(rules.reculVoie, 1, lng)
                          : `${formatNumber(rules.prospectMin, 1, lng)} / H×${formatNumber(rules.prospectRatio, 2, lng)}`
                      }
                      min={0}
                      suffix="m"
                      onCommit={(v) =>
                        setRule('edgeRecul', { ...(rules.edgeRecul ?? {}), [r.key]: v })
                      }
                    />
                  </td>
                  <td>
                    {rules.edgeRecul?.[r.key] !== undefined && (
                      <button
                        className="btn btn-small"
                        onClick={() => {
                          const next = { ...rules.edgeRecul };
                          delete next[r.key];
                          setRule('edgeRecul', Object.keys(next).length ? next : undefined);
                        }}
                      >
                        {t('rules.clear')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted auto-note">{t('auto.edgeNote')}</p>

          <h3>{t('auto.forms')}</h3>
          <div className="auto-chips">
            {AUTO_FAMILIES.map((f) => (
              <label key={f} className="auto-chip">
                <input
                  type="checkbox"
                  checked={stored.families.includes(f)}
                  onChange={() => update({ ...stored, families: toggle(stored.families, f) })}
                />
                {t(`auto.family.${f}`)}
              </label>
            ))}
          </div>
          {num(
            t('auto.maxBuildings'),
            stored.maxBuildings,
            (v) =>
              update({ ...stored, maxBuildings: Math.max(1, Math.min(6, Math.round(v ?? 1))) }),
            { integer: true },
          )}
          {stored.usages.map((u) => {
            const o = stored.options[u];
            const setO = (patch: Partial<typeof o>) =>
              update({ ...stored, options: { ...stored.options, [u]: { ...o, ...patch } } });
            return (
              <div key={u}>
                <h3>{t('auto.depthsOf', { use: t(`common:usage.${u}`) })}</h3>
                {num(t('auto.depthMin'), o.depth[0], (v) => setO({ depth: [v ?? 0, o.depth[1]] }), {
                  suffix: 'm',
                })}
                {num(t('auto.depthMax'), o.depth[1], (v) => setO({ depth: [o.depth[0], v ?? 0] }), {
                  suffix: 'm',
                })}
                {num(
                  t('auto.pointMin'),
                  o.pointSide[0],
                  (v) => setO({ pointSide: [v ?? 0, o.pointSide[1]] }),
                  { suffix: 'm' },
                )}
                {num(
                  t('auto.pointMax'),
                  o.pointSide[1],
                  (v) => setO({ pointSide: [o.pointSide[0], v ?? 0] }),
                  { suffix: 'm' },
                )}
              </div>
            );
          })}
          <div className="auto-run">
            <button
              className="btn btn-primary"
              disabled={busy || !stored.usages.length || !stored.families.length}
              onClick={run}
            >
              {busy ? t('auto.running') : t('auto.run')}
            </button>
          </div>
        </div>

        <div className="auto-results">
          {!results && <p className="muted auto-empty">{t('auto.empty')}</p>}
          {results?.map(({ usage, scenarios }) => (
            <section key={usage}>
              <h3>{t(`common:usage.${usage}`)}</h3>
              {!scenarios.length && <p className="muted">{t('auto.none')}</p>}
              <div className="auto-cards">
                {scenarios.map((s, i) => (
                  <article key={s.id} className={`auto-card${i === 0 ? ' is-best' : ''}`}>
                    <header>
                      <strong>{t(`auto.family.${s.family}`)}</strong>
                      <span className="auto-formula">R+{s.levels - 1}</span>
                      {i === 0 && <span className="auto-best">{t('auto.best')}</span>}
                    </header>
                    <SitePlan
                      boundary={project.site.boundary}
                      envelope={s.envelope}
                      rows={rows}
                      footprints={s.masses.flatMap((m) => massFootprints(m))}
                    />
                    <dl className="auto-kpis">
                      <dt>{t('common:kpi.surfaceDePlancher')}</dt>
                      <dd>{formatNumber(s.surfaceDePlancher, 0, lng)} m²</dd>
                      <dt>{t('common:kpi.nuf')}</dt>
                      <dd>{formatNumber(s.nuf, 0, lng)} m²</dd>
                      <dt>{t('common:kpi.emprise')}</dt>
                      <dd>
                        {formatNumber(s.footprintArea, 0, lng)} m² · CES{' '}
                        {formatNumber(s.ces * 100, 0, lng)} %
                      </dd>
                      <dt>{t('common:kpi.hauteurEgout')}</dt>
                      <dd>{formatNumber(s.height, 2, lng)} m</dd>
                      <dt>{t('auto.buildings')}</dt>
                      <dd>{s.masses.length}</dd>
                      {usage === 'buero' ? (
                        <>
                          <dt>{t('auto.workplaces')}</dt>
                          <dd>{formatNumber(s.workplaces, 0, lng)}</dd>
                        </>
                      ) : (
                        <>
                          <dt>{t('common:kpi.logements')}</dt>
                          <dd>{formatNumber(s.dwellings, 0, lng)}</dd>
                        </>
                      )}
                    </dl>
                    {s.limits.length > 0 && (
                      <div className="auto-limits" title={t('auto.limitsTip')}>
                        {s.limits.map((l) => (
                          <span key={l} className="auto-limit">
                            {t(`auto.limit.${l}`)}
                          </span>
                        ))}
                      </div>
                    )}
                    <button
                      className={`btn ${created[s.id] ? '' : 'btn-primary'}`}
                      disabled={created[s.id]}
                      onClick={() => adopt(s)}
                    >
                      {created[s.id] ? t('auto.done') : t('auto.adopt')}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Small site plan: boundary (edges coloured by kind, numbered), envelope, footprints. */
function SitePlan(props: {
  boundary: Polygon;
  envelope: Polygon[];
  rows: EdgeRow[];
  footprints: Polygon[];
}) {
  const pts = props.boundary.outer;
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  // y up in the model, down in SVG
  const p = ([x, y]: Vec2) => `${(x - minX + pad).toFixed(2)},${(maxY - y + pad).toFixed(2)}`;
  const path = (poly: Polygon) =>
    [poly.outer, ...(poly.holes ?? [])].map((r) => `M${r.map(p).join('L')}Z`).join('');
  const sw = Math.max(w, h) / 220;
  return (
    <svg className="auto-plan" viewBox={`0 0 ${w} ${h}`} role="img">
      <path d={path(props.boundary)} className="auto-plan-site" />
      {props.envelope.map((e, i) => (
        <path
          key={i}
          d={path(e)}
          className="auto-plan-env"
          strokeWidth={sw}
          strokeDasharray={`${sw * 4} ${sw * 3}`}
        />
      ))}
      {props.footprints.map((f, i) => (
        <path key={i} d={path(f)} className="auto-plan-fp" strokeWidth={sw} />
      ))}
      {props.rows.flatMap((r) =>
        r.segs.map((s, i) => (
          <line
            key={`${r.key}-${i}`}
            x1={s.a[0] - minX + pad}
            y1={maxY - s.a[1] + pad}
            x2={s.b[0] - minX + pad}
            y2={maxY - s.b[1] + pad}
            className={isStreet(s.kind) ? 'auto-plan-street' : 'auto-plan-nb'}
            strokeWidth={sw * 2.5}
          />
        )),
      )}
      {props.footprints.length === 0 &&
        props.rows.map((r) => {
          const s = r.segs[Math.floor(r.segs.length / 2)]!;
          const mx = (s.a[0] + s.b[0]) / 2;
          const my = (s.a[1] + s.b[1]) / 2;
          return (
            <text
              key={r.key}
              x={mx - minX + pad}
              y={maxY - my + pad}
              className="auto-plan-label"
              fontSize={sw * 11}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {r.n}
            </text>
          );
        })}
    </svg>
  );
}
