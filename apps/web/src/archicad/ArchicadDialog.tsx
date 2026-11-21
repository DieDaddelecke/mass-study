import type { Usage } from '@kubatur/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatNumber } from '../i18n';
import { useProjectStore } from '../store/projectStore';
import { Dialog, NumField, Row } from '../shell/ui';
import { planFor, useArchicadStore } from './archicadStore';
import type { PlanWarning } from './plan';
import './archicad.css';

/** "Archicad" dialog: bridge pairing, instance choice, options, preview, transfer. */
export function ArchicadDialog() {
  const s = useArchicadStore();
  const project = useProjectStore((p) => p.project);
  const { t } = useTranslation('archicad');
  const usageLabel = (u: Usage) => t(`common:usage.${u}`);

  const plan = useMemo(
    () => (project && s.snapshot ? planFor(project, s.snapshot, s.options, usageLabel) : null),
    // usageLabel only depends on the language (t)
    [project, s.snapshot, s.options, t],
  );

  if (!s.open || !project) return null;
  const instance = s.instances.find((i) => i.port === s.port);
  const projectTitle = instance?.project?.isUntitled
    ? t('untitled')
    : (s.snapshot?.projectName ?? instance?.project?.projectName ?? '?');
  const nothing = !plan || plan.items.length === 0;

  return (
    <Dialog
      open
      wide
      title={t('title')}
      onClose={s.close}
      footer={
        <>
          {s.snapshot && s.snapshot.ownElements > 0 && (
            <button className="btn" disabled={s.busy} onClick={() => void s.remove(project)}>
              {t('remove', { count: s.snapshot.ownElements })}
            </button>
          )}
          <span className="ac-spacer" />
          <button className="btn" onClick={s.close}>
            {t('common:actions.close')}
          </button>
          <button
            className="btn btn-primary"
            disabled={s.busy || nothing || s.port === undefined}
            onClick={() => plan && void s.transfer(project, plan, usageLabel)}
          >
            {s.mode === 'replace'
              ? t('update', { name: projectTitle })
              : t('transfer', { name: projectTitle })}
          </button>
        </>
      }
    >
      <div className="ac">
        {/* 1. bridge */}
        <section className="ac-section">
          <h3>{t('bridge.title')}</h3>
          <div className={`ac-status is-${s.status}`}>
            {t(`bridge.status.${s.status}`, { version: s.bridgeVersion ?? '' })}
          </div>
          {s.status === 'offline' && (
            <p className="ac-help">
              {t('bridge.howTo')}
              <code>python tools/archicad-bridge/bridge.py</code>
            </p>
          )}
          {(s.status === 'unpaired' || s.status === 'offline') && (
            <Row label={t('bridge.token')}>
              <input
                value={s.token}
                placeholder="XXXX-XXXX"
                onChange={(e) => s.setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void s.connect()}
              />
            </Row>
          )}
          <details className="ac-advanced">
            <summary>{t('bridge.advanced')}</summary>
            <Row label={t('bridge.url')}>
              <input value={s.bridgeUrl} onChange={(e) => s.setBridgeUrl(e.target.value)} />
            </Row>
          </details>
          {s.status !== 'ready' && (
            <button
              className="btn btn-sm"
              disabled={s.status === 'checking'}
              onClick={() => void s.connect()}
            >
              {t('bridge.connect')}
            </button>
          )}
        </section>

        {/* 2. instance */}
        {s.status === 'ready' && (
          <section className="ac-section">
            <h3>{t('instance.title')}</h3>
            {s.instances.length === 0 ? (
              <p className="ac-help">{t('instance.none')}</p>
            ) : (
              <ul className="ac-instances">
                {s.instances.map((i) => (
                  <li key={i.port}>
                    <label>
                      <input
                        type="radio"
                        name="ac-instance"
                        checked={s.port === i.port}
                        disabled={!i.tapirVersion || s.busy}
                        onChange={() => void s.selectInstance(i.port, project.id)}
                      />
                      <strong>
                        {i.project?.isUntitled ? t('untitled') : (i.project?.projectName ?? '?')}
                      </strong>
                      <span className="ac-muted">
                        {' '}
                        Archicad {i.product?.version ?? '?'} · Tapir{' '}
                        {i.tapirVersion ?? t('instance.noTapir')} · :{i.port}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="btn btn-sm btn-ghost"
              disabled={s.busy}
              onClick={() => void s.connect()}
            >
              {t('instance.refresh')}
            </button>
          </section>
        )}

        {/* 3. options + preview */}
        {s.snapshot && plan && (
          <>
            <section className="ac-section">
              <h3>{t('options.title')}</h3>
              <div className="ac-checks">
                {(['zones', 'morphs', 'slabs'] as const).map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={s.options[k]}
                      onChange={(e) => s.setOptions({ [k]: e.target.checked })}
                    />
                    {t(`options.${k}`)}
                  </label>
                ))}
              </div>
              <div className="ac-place">
                <Row label={t('options.offsetX')}>
                  <NumField
                    value={s.options.offsetX}
                    onCommit={(v) => s.setOptions({ offsetX: v })}
                    suffix="m"
                  />
                </Row>
                <Row label={t('options.offsetY')}>
                  <NumField
                    value={s.options.offsetY}
                    onCommit={(v) => s.setOptions({ offsetY: v })}
                    suffix="m"
                  />
                </Row>
                <Row label={t('options.rotation')}>
                  <NumField
                    value={s.options.rotationDeg}
                    onCommit={(v) => s.setOptions({ rotationDeg: v })}
                    suffix="°"
                  />
                </Row>
              </div>
              {s.snapshot.ownElements > 0 && (
                <div className="ac-checks">
                  <label>
                    <input
                      type="radio"
                      checked={s.mode === 'replace'}
                      onChange={() => s.setMode('replace')}
                    />
                    {t('mode.replace', { count: s.snapshot.ownElements })}
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={s.mode === 'create'}
                      onChange={() => s.setMode('create')}
                    />
                    {t('mode.create')}
                  </label>
                </div>
              )}
            </section>

            <section className="ac-section">
              <h3>{t('preview.title')}</h3>
              <p>
                {t('preview.summary', {
                  zones: plan.counts.zones,
                  morphs: plan.counts.morphs,
                  slabs: plan.counts.slabs,
                  storeys: plan.counts.storeys,
                })}
              </p>
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>{t('preview.level')}</th>
                    <th>{t('preview.storey')}</th>
                    <th>{t('preview.archicadStory')}</th>
                    <th>{t('preview.offset')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.storeys.map((m) => (
                    <tr key={m.elevation} className={m.exact ? '' : 'is-warn'}>
                      <td>{formatNumber(m.elevation, 2)} m</td>
                      <td>{m.label}</td>
                      <td>{m.storyName}</td>
                      <td>{m.offset ? `+${formatNumber(m.offset, 2)} m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ac-help">{t('preview.storiesUnchanged')}</p>
              {plan.warnings.length > 0 && (
                <ul className="ac-warnings">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{warningText(t, w)}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* 4. progress / result */}
        {s.progress && (
          <div className="ac-progress">
            <progress max={Math.max(1, s.progress.total)} value={s.progress.done} />
            <span>{t(`progress.${s.progress.step}`)}</span>
          </div>
        )}
        {s.report && (
          <div className={`ac-result${s.report.errors.length ? ' is-warn' : ' is-ok'}`}>
            <p>{t('result.created', s.report.created)}</p>
            {s.report.deleted > 0 && <p>{t('result.deleted', { count: s.report.deleted })}</p>}
            {s.report.zoneFallback && <p>{t('result.zoneFallback')}</p>}
            {s.report.errors.length > 0 && (
              <ul>
                {s.report.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    {e.item ? `${e.item} : ` : ''}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {s.removed !== undefined && (
          <div className="ac-result is-ok">{t('result.removed', { count: s.removed })}</div>
        )}
        {s.error && <div className="ac-result is-error">{s.error}</div>}
      </div>
    </Dialog>
  );
}

function warningText(t: TFunction<'archicad'>, w: PlanWarning): string {
  switch (w.code) {
    case 'librariesMissing':
      return t('warning.librariesMissing', { names: w.names.join(', ') });
    case 'levelWithoutStory':
      return t('warning.levelWithoutStory', {
        level: formatNumber(w.elevation, 2),
        label: w.label,
        story: w.storyName,
      });
    case 'belowLowestStory':
      return t('warning.belowLowestStory', { level: formatNumber(w.elevation, 2), label: w.label });
    default:
      return t(`warning.${w.code}`);
  }
}
