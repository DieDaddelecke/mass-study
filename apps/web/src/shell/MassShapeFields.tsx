import {
  DEFAULT_ROOF_PITCH,
  DEFAULT_TREE_SPACING,
  PLANTING_KINDS,
  polygonArea,
  rotatePoint,
  ROOF_KINDS,
  type Mass,
  type PlantingKind,
  type PlantingZone,
  type RoofKind,
  type SetbackDistance,
  type TerraceStep,
} from '@kubatur/core';
import type { Draft } from 'immer';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { actions } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Group, NumField, Row } from './ui';

type Side = 'all' | 'front' | 'back' | 'left' | 'right';
const SIDES: Side[] = ['all', 'front', 'back', 'left', 'right'];

/** Compass orientation of a local side of the mass (outward normal). */
export function sideOrientation(rotation: number, side: Exclude<Side, 'all'>): string {
  const n: [number, number] =
    side === 'front' ? [0, -1] : side === 'back' ? [0, 1] : side === 'left' ? [-1, 0] : [1, 0];
  const [x, y] = rotatePoint(n, rotation);
  const a = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360; // 0 = north, clockwise
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8]!;
}

function sideOf(d: SetbackDistance): { side: Side; dist: number } {
  if (typeof d === 'number') return { side: 'all', dist: d };
  for (const s of ['front', 'back', 'left', 'right'] as const)
    if (d[s] > 0) return { side: s, dist: d[s] };
  return { side: 'front', dist: 0 };
}

function distanceFor(side: Side, d: number): SetbackDistance {
  if (side === 'all') return d;
  return { front: 0, back: 0, left: 0, right: 0, [side]: d };
}

/** Regular terracing: from storey `from` every storey steps back by `step` more. */
export function regularTerraces(
  from: number,
  top: number,
  side: Side,
  step: number,
): TerraceStep[] {
  const out: TerraceStep[] = [];
  for (let i = Math.max(1, from); i <= top; i++)
    out.push({ fromStorey: i, distance: distanceFor(side, step * (i - from + 1)) });
  return out;
}

export function RoofFields({
  mass,
  update,
}: {
  mass: Mass;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t } = useTranslation('shell');
  const roof = mass.roof ?? { kind: 'flat' as RoofKind, pitch: 0, ridge: 'length' as const };
  const pitched = roof.kind !== 'flat';
  return (
    <Group title={t('roof.title')}>
      <Row label={t('roof.kind')}>
        <select
          aria-label={t('roof.kind')}
          value={roof.kind}
          onChange={(e) =>
            update((m) => {
              const kind = e.target.value as RoofKind;
              if (kind === 'flat') delete m.roof;
              else
                m.roof = {
                  kind,
                  pitch: m.roof && m.roof.kind !== 'flat' ? m.roof.pitch : DEFAULT_ROOF_PITCH[kind],
                  ridge: m.roof?.ridge ?? 'length',
                };
            })
          }
        >
          {ROOF_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`roof.kinds.${k}`)}
            </option>
          ))}
        </select>
      </Row>
      {pitched && (
        <>
          <Row label={t('roof.pitch')}>
            <NumField
              ariaLabel={t('roof.pitch')}
              value={roof.pitch}
              digits={1}
              min={1}
              max={70}
              suffix="°"
              onCommit={(v) => update((m) => void (m.roof && (m.roof.pitch = v)))}
            />
          </Row>
          {roof.kind !== 'hip' && (
            <Row label={roof.kind === 'shed' ? t('roof.slope') : t('roof.ridge')}>
              <select
                aria-label={t('roof.ridge')}
                value={roof.ridge}
                onChange={(e) =>
                  update(
                    (m) => void (m.roof && (m.roof.ridge = e.target.value as 'length' | 'depth')),
                  )
                }
              >
                <option value="length">{t('roof.alongLength')}</option>
                <option value="depth">{t('roof.alongDepth')}</option>
              </select>
            </Row>
          )}
          {roof.kind === 'shed' && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => update((m) => void (m.roof && (m.roof.flip = !m.roof.flip)))}
            >
              {t('roof.flip')}
            </button>
          )}
          <p className="muted prop-note">{t('roof.note')}</p>
        </>
      )}
    </Group>
  );
}

export function TerraceFields({
  mass,
  update,
}: {
  mass: Mass;
  update: (recipe: (m: Draft<Mass>) => void) => void;
}) {
  const { t } = useTranslation('shell');
  const steps = [...(mass.storeys.terraces ?? [])].sort((a, b) => a.fromStorey - b.fromStorey);
  const top = mass.storeys.upper.count;
  const [gen, setGen] = useState<{ from: number; side: Side; step: number }>({
    from: Math.max(1, top - 2),
    side: 'front',
    step: 2,
  });
  const sideLabel = (s: Side) =>
    s === 'all'
      ? t('terrace.sides.all')
      : `${t(`terrace.sides.${s}`)} (${sideOrientation(mass.rotation, s)})`;
  const setSteps = (next: TerraceStep[]) =>
    update((m) => {
      if (next.length) m.storeys.terraces = next;
      else delete m.storeys.terraces;
    });
  return (
    <Group title={t('terrace.title')}>
      {steps.map((st, i) => {
        const { side, dist } = sideOf(st.distance);
        const put = (p: Partial<{ from: number; side: Side; dist: number }>) =>
          setSteps(
            steps.map((x, j) =>
              j === i
                ? {
                    fromStorey: p.from ?? x.fromStorey,
                    distance: distanceFor(p.side ?? side, p.dist ?? dist),
                  }
                : x,
            ),
          );
        return (
          <div key={i} className="terrace-row">
            <NumField
              ariaLabel={t('terrace.from')}
              value={st.fromStorey}
              integer
              min={1}
              max={Math.max(1, top)}
              onCommit={(v) => put({ from: v })}
            />
            <select
              aria-label={t('terrace.side')}
              value={side}
              onChange={(e) => put({ side: e.target.value as Side })}
            >
              {SIDES.map((s) => (
                <option key={s} value={s}>
                  {sideLabel(s)}
                </option>
              ))}
            </select>
            <NumField
              ariaLabel={t('terrace.distance')}
              value={dist}
              min={0}
              suffix="m"
              onCommit={(v) => put({ dist: v })}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={t('terrace.remove')}
              title={t('terrace.remove')}
              onClick={() => setSteps(steps.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-small"
        disabled={top < 1}
        onClick={() =>
          setSteps([
            ...steps,
            {
              fromStorey: Math.min(top, (steps[steps.length - 1]?.fromStorey ?? top - 1) + 1) || 1,
              distance: distanceFor('front', 2),
            },
          ])
        }
      >
        {t('terrace.add')}
      </button>
      <div className="terrace-gen">
        <span className="muted prop-note">{t('terrace.regular')}</span>
        <div className="terrace-row">
          <NumField
            ariaLabel={t('terrace.from')}
            value={gen.from}
            integer
            min={1}
            onCommit={(v) => setGen({ ...gen, from: v })}
          />
          <select
            aria-label={t('terrace.side')}
            value={gen.side}
            onChange={(e) => setGen({ ...gen, side: e.target.value as Side })}
          >
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {sideLabel(s)}
              </option>
            ))}
          </select>
          <NumField
            ariaLabel={t('terrace.step')}
            value={gen.step}
            min={0.5}
            suffix="m"
            onCommit={(v) => setGen({ ...gen, step: v })}
          />
        </div>
        <button
          type="button"
          className="btn btn-small"
          disabled={top < 1}
          onClick={() => setSteps(regularTerraces(gen.from, top, gen.side, gen.step))}
        >
          {t('terrace.generate')}
        </button>
      </div>
    </Group>
  );
}

export function PlantingProperties({ zone }: { zone: PlantingZone }) {
  const { t, i18n } = useTranslation('shell');
  const update = (recipe: (z: Draft<PlantingZone>) => void) =>
    actions.updatePlanting(zone.id, recipe);
  return (
    <>
      <Group title={t('props.group.identity')}>
        <Row label={t('props.name')}>
          <input
            aria-label={t('props.name')}
            defaultValue={zone.name}
            key={zone.id + zone.name}
            onBlur={(e) =>
              e.target.value !== zone.name && update((z) => void (z.name = e.target.value))
            }
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Row>
        <Row label={t('green.kind')}>
          <select
            aria-label={t('green.kind')}
            value={zone.kind}
            onChange={(e) =>
              update((z) => {
                const k = e.target.value as PlantingKind;
                z.kind = k;
                if (!z.treeSpacing && DEFAULT_TREE_SPACING[k])
                  z.treeSpacing = DEFAULT_TREE_SPACING[k];
              })
            }
          >
            {PLANTING_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`green.kinds.${k}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('props.area')}>
          <span className="ro num">
            {formatNumber(polygonArea(zone.polygon), 0, i18n.language)} m²
          </span>
        </Row>
      </Group>
      <Group title={t('green.trees')}>
        <Row label={t('green.treeSpacing')}>
          <NumField
            ariaLabel={t('green.treeSpacing')}
            value={zone.treeSpacing ?? 0}
            min={0}
            suffix="m"
            onCommit={(v) => update((z) => void (z.treeSpacing = v))}
          />
        </Row>
        <Row label={t('green.treeHeight')}>
          <NumField
            ariaLabel={t('green.treeHeight')}
            value={zone.treeHeight ?? 8}
            min={1}
            suffix="m"
            onCommit={(v) => update((z) => void (z.treeHeight = v))}
          />
        </Row>
        <p className="muted prop-note">{t('green.treeNote')}</p>
      </Group>
      <button
        type="button"
        className="btn btn-sm btn-block"
        onClick={() => {
          actions.deleteMasses([zone.id]);
          useUiStore.getState().setSelection([]);
        }}
      >
        {t('green.delete')}
      </button>
    </>
  );
}
