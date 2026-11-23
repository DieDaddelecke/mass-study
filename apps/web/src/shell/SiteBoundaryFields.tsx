import {
  BOUNDARY_KINDS,
  resolveBoundaryRules,
  siteBoundaries,
  type BoundaryKind,
  type BoundarySegment,
} from '@kubatur/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Group, NumField, Row } from './ui';

/** Hover id of a boundary edge (highlighted in the 3D view and the plan). */
export const boundaryHoverId = (key: string) => `boundary:${key}`;

interface Edge {
  key: string;
  index: number;
  length: number;
  kind: BoundaryKind;
  auto: BoundaryKind;
  mixed: boolean;
  overridden: boolean;
  name?: string;
}

function edgesOf(segs: readonly BoundarySegment[]): Edge[] {
  const out: Edge[] = [];
  for (const s of segs) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const e = out.find((x) => x.key === s.key);
    if (!e) {
      out.push({
        key: s.key,
        index: s.edge,
        length: len,
        kind: s.kind,
        auto: s.auto,
        mixed: false,
        overridden: s.overridden,
        ...(s.name ? { name: s.name } : {}),
      });
      continue;
    }
    e.length += len;
    if (s.kind !== e.kind) e.mixed = true;
    if (!e.name && s.name) e.name = s.name;
  }
  return out;
}

/**
 * Site boundaries: street / path / public space / neighbouring parcel per edge (automatic from
 * the cadastre and the streets, overridable), and the rule "no windows towards neighbours".
 */
export function SiteBoundaryFields() {
  const { t, i18n } = useTranslation('shell');
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const setHover = useUiStore((s) => s.setHover);
  const n = (v: number, d = 1) => formatNumber(v, d, i18n.language);
  const edges = useMemo(
    () => edgesOf(siteBoundaries(project.site, project.surroundings)),
    [project.site, project.surroundings],
  );
  const rules = resolveBoundaryRules(project.settings);
  if (!edges.length) return null;
  const setKind = (key: string, v: string) =>
    update((p) => {
      const kinds = { ...(p.site.edgeKinds ?? {}) };
      if (v === 'auto') delete kinds[key];
      else kinds[key] = v as BoundaryKind;
      if (Object.keys(kinds).length) p.site.edgeKinds = kinds;
      else delete p.site.edgeKinds;
    });
  const setRules = (patch: Partial<typeof rules>) =>
    update((p) => {
      p.settings.boundaryRules = { ...resolveBoundaryRules(p.settings), ...patch };
    });
  const neighbours = edges.filter((e) => e.kind === 'neighbour').length;
  return (
    <Group title={t('boundary.title')}>
      <p className="muted prop-note">
        {neighbours
          ? t('boundary.summary', { count: neighbours, total: edges.length })
          : t('boundary.noNeighbour')}
      </p>
      <ul className="boundary-list">
        {edges.map((e) => (
          <li
            key={e.key}
            onPointerEnter={() => setHover(boundaryHoverId(e.key))}
            onPointerLeave={() => setHover(null)}
          >
            <span className={`boundary-sw boundary-${e.mixed ? 'mixed' : e.kind}`} />
            <span
              className="boundary-name"
              title={[t('boundary.edge', { n: e.index + 1 }), t(`boundary.kind.${e.kind}`), e.name]
                .filter(Boolean)
                .join(' · ')}
            >
              <strong>{e.index + 1}</strong> · {n(e.length)} m
              {e.name && e.kind !== 'neighbour' ? <span className="muted"> · {e.name}</span> : null}
            </span>
            <select
              aria-label={t('boundary.edge', { n: e.index + 1 })}
              value={e.overridden ? e.kind : 'auto'}
              onChange={(ev) => setKind(e.key, ev.target.value)}
            >
              <option value="auto">
                {t('boundary.auto', {
                  kind: e.mixed ? t('boundary.mixed') : t(`boundary.short.${e.auto}`),
                })}
              </option>
              {BOUNDARY_KINDS.filter((k) => k !== 'unknown').map((k) => (
                <option key={k} value={k} title={t(`boundary.kind.${k}`)}>
                  {t(`boundary.short.${k}`)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <Row label={t('boundary.noWindows')}>
        <input
          type="checkbox"
          aria-label={t('boundary.noWindows')}
          checked={rules.enabled}
          onChange={(e) => setRules({ enabled: e.target.checked })}
        />
      </Row>
      {rules.enabled && (
        <>
          <Row label={t('boundary.vueMin')}>
            <NumField
              value={rules.vueMin}
              digits={1}
              min={0}
              max={50}
              suffix="m"
              onCommit={(v) => setRules({ vueMin: v })}
            />
          </Row>
          <Row label={t('boundary.vueRatio')}>
            <NumField
              value={rules.vueRatio}
              digits={2}
              min={0}
              max={2}
              suffix="× H"
              onCommit={(v) => setRules({ vueRatio: v })}
            />
          </Row>
          <p className="muted prop-note">
            {t('boundary.note', { min: n(rules.vueMin), ratio: n(rules.vueRatio, 2) })}
          </p>
        </>
      )}
    </Group>
  );
}
