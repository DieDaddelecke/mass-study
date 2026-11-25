import type { Project } from '@kubatur/core';
import { Download, ExternalLink, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RenderRequestError, renderApi } from '../api/client';
import {
  RENDER_PROVIDERS,
  type RenderProviderId,
  type RenderProvidersResponse,
} from '../api/contract';
import { downloadBlob, safeFileName } from '../exports/download';
import { useShellStore } from '../shell/shellStore';
import { Dialog, Row } from '../shell/ui';
import { useDisplayMode } from '../store/display';
import { useViewportStore } from '../viewport/viewportStore';
import { openRenderDialog } from './capture';
import {
  FACADE_MATERIALS,
  NEGATIVE_PROMPT,
  RENDER_STYLES,
  buildPrompt,
  type PromptOptions,
} from './prompt';
import { useRenderStore } from './renderStore';
import './render.css';

/** Where to get a key, per provider. */
export const KEY_URLS: Record<RenderProviderId, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  stability: 'https://platform.stability.ai/account/keys',
  openai: 'https://platform.openai.com/api-keys',
};

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/** "Rendu IA" (AI rendering of the current 3D view): prompt, style, provider, result. */
export function RenderDialog({ project }: { project: Project }) {
  const { t } = useTranslation('render');
  const close = () => useShellStore.getState().setDialog(null);
  const { settings: s, capture, results, update, addResult } = useRenderStore();
  const look = useViewportStore((v) => v.look);
  const mode = useDisplayMode();
  const promptOpts: PromptOptions = useMemo(
    () => ({
      style: s.style,
      material: s.material,
      animate: s.animate,
      look,
      colourCoded: mode === 'usages' || mode === 'granulometrie',
    }),
    [s.style, s.material, s.animate, look, mode],
  );
  const auto = useMemo(() => buildPrompt(project, promptOpts), [project, promptOpts]);
  // The prompt follows the options until the user edits it.
  const [edited, setEdited] = useState<string | null>(null);
  const prompt = edited ?? auto;
  const [negative, setNegative] = useState(NEGATIVE_PROMPT);
  const [server, setServer] = useState<RenderProvidersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(results[0]?.id ?? null);
  const [compare, setCompare] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    renderApi
      .providers(ac.signal)
      .then(setServer)
      .catch(() => setServer(null));
    return () => {
      ac.abort();
      abort.current?.abort();
    };
  }, []);

  const info = server?.providers.find((p) => p.id === s.provider);
  const key = s.keys[s.provider] ?? '';
  const hasKey = !!key.trim() || !!info?.serverKey;
  const model = s.models[s.provider] ?? '';
  const result = results.find((r) => r.id === shown) ?? null;
  const canRun = !!capture && hasKey && s.paidOk && !!prompt.trim() && !busy;

  const run = async () => {
    if (!capture || !canRun) return;
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await renderApi.render(
        {
          provider: s.provider,
          model: model.trim() || undefined,
          prompt,
          negativePrompt: negative.trim() || undefined,
          image: capture.image,
          fidelity: s.fidelity,
          aspect: capture.width / capture.height,
        },
        key,
        ac.signal,
      );
      const id = `${Date.now()}`;
      addResult({
        id,
        image: r.image,
        provider: r.provider,
        model: r.model,
        prompt,
        at: new Date().toISOString(),
      });
      setShown(id);
      setCompare(false);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof RenderRequestError) {
        const code = e.body?.error;
        const known = code && code !== 'upstream_error' && code !== 'bad_request';
        setError(
          known
            ? `${t(`errors.${code}`)}${e.body?.message ? ` (${e.body.message})` : ''}`
            : (e.body?.message ?? t('errors.network')),
        );
      } else setError(t('errors.network'));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const download = async () => {
    if (!result) return;
    const ext = result.image.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const stamp = result.at.slice(0, 16).replace(/[-:T]/g, '');
    downloadBlob(
      await dataUrlToBlob(result.image),
      `${safeFileName(project.name)}_rendu_${stamp}.${ext}`,
    );
  };

  const recapture = async () => {
    await openRenderDialog();
  };

  const shownImage = result && !compare ? result.image : capture?.image;

  return (
    <Dialog
      open
      wide
      title={t('title')}
      onClose={close}
      footer={
        <>
          <span className="rnd-cost muted">{t(`cost.${s.provider}`)}</span>
          <button className="btn" onClick={close}>
            {t('close')}
          </button>
          {busy ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              {t('cancel')}
            </button>
          ) : null}
          <button className="btn btn-primary" disabled={!canRun} onClick={() => void run()}>
            <Sparkles size={15} strokeWidth={1.75} />
            {busy ? t('running') : results.length ? t('runAgain') : t('run')}
          </button>
        </>
      }
    >
      <div className="rnd">
        <div className="rnd-view">
          <div className={`rnd-frame${busy ? ' is-busy' : ''}`}>
            {shownImage ? (
              <img
                src={shownImage}
                alt={result && !compare ? t('resultAlt') : t('captureAlt')}
                style={capture ? { aspectRatio: `${capture.width} / ${capture.height}` } : {}}
              />
            ) : (
              <p className="muted">{t('noCapture')}</p>
            )}
            {busy && <div className="rnd-spinner">{t('running')}</div>}
            {result && <span className="rnd-badge">{compare ? t('before') : t('after')}</span>}
          </div>
          {error && (
            <p className="rnd-error" role="alert">
              {error}
            </p>
          )}
          <div className="rnd-actions">
            <button className="btn btn-small" onClick={() => void recapture()} disabled={busy}>
              <RefreshCw size={14} strokeWidth={1.75} />
              {t('recapture')}
            </button>
            {result && (
              <>
                <button
                  className={`btn btn-small${compare ? ' is-on' : ''}`}
                  onClick={() => setCompare(!compare)}
                  aria-pressed={compare}
                >
                  {t('compare')}
                </button>
                <button className="btn btn-small" onClick={() => void download()}>
                  <Download size={14} strokeWidth={1.75} />
                  {t('download')}
                </button>
              </>
            )}
          </div>
          {results.length > 0 && (
            <div className="rnd-history" aria-label={t('history')}>
              {results.map((r) => (
                <button
                  key={r.id}
                  className={`rnd-thumb${r.id === shown ? ' is-on' : ''}`}
                  title={`${t(`providers.${r.provider}`)} · ${r.model}`}
                  onClick={() => {
                    setShown(r.id);
                    setCompare(false);
                  }}
                >
                  <img src={r.image} alt="" />
                </button>
              ))}
            </div>
          )}
          <p className="muted rnd-note">{t('captureNote')}</p>
        </div>

        <div className="rnd-form">
          <Row label={t('style')}>
            <select
              aria-label={t('style')}
              value={s.style}
              onChange={(e) => update({ style: e.target.value as typeof s.style })}
            >
              {RENDER_STYLES.map((v) => (
                <option key={v} value={v}>
                  {t(`styles.${v}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('material')}>
            <select
              aria-label={t('material')}
              value={s.material}
              onChange={(e) => update({ material: e.target.value as typeof s.material })}
            >
              {FACADE_MATERIALS.map((v) => (
                <option key={v} value={v}>
                  {t(`materials.${v}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('animate')}>
            <input
              type="checkbox"
              aria-label={t('animate')}
              checked={s.animate}
              onChange={(e) => update({ animate: e.target.checked })}
            />
          </Row>
          <Row label={t('fidelity')}>
            <span className="rnd-range">
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                aria-label={t('fidelity')}
                value={s.fidelity}
                onChange={(e) => update({ fidelity: Number(e.target.value) })}
              />
              <span>{Math.round(s.fidelity * 100)} %</span>
            </span>
          </Row>

          <div className="rnd-prompt">
            <div className="rnd-prompt-head">
              <span className="prow-label">{t('prompt')}</span>
              {edited !== null && (
                <button className="btn btn-small" onClick={() => setEdited(null)}>
                  <Wand2 size={13} strokeWidth={1.75} />
                  {t('resetPrompt')}
                </button>
              )}
            </div>
            <textarea
              aria-label={t('prompt')}
              rows={9}
              value={prompt}
              onChange={(e) => setEdited(e.target.value)}
            />
            <p className="muted">{t('promptNote')}</p>
          </div>

          <details className="rnd-adv">
            <summary>{t('negative')}</summary>
            <textarea
              aria-label={t('negative')}
              rows={3}
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </details>

          <h3>{t('provider')}</h3>
          <Row label={t('provider')}>
            <select
              aria-label={t('provider')}
              value={s.provider}
              onChange={(e) => update({ provider: e.target.value as RenderProviderId })}
            >
              {RENDER_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`providers.${p}`)}
                </option>
              ))}
            </select>
          </Row>
          <p className="muted rnd-hint">{t(`providerHints.${s.provider}`)}</p>
          <Row label={t('apiKey')}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('apiKey')}
              placeholder={info?.serverKey ? t('serverKey') : t('keyPlaceholder')}
              value={key}
              onChange={(e) => update({ keys: { ...s.keys, [s.provider]: e.target.value } })}
            />
          </Row>
          <p className="muted rnd-hint">
            <a href={KEY_URLS[s.provider]} target="_blank" rel="noreferrer">
              {t('getKey')} <ExternalLink size={11} />
            </a>{' '}
            · {t('keyNote')}
          </p>
          <Row label={t('rememberKey')}>
            <input
              type="checkbox"
              aria-label={t('rememberKey')}
              checked={s.rememberKeys}
              onChange={(e) => update({ rememberKeys: e.target.checked })}
            />
          </Row>
          <Row label={t('model')}>
            <input
              aria-label={t('model')}
              spellCheck={false}
              placeholder={info?.defaultModel ?? t('defaultModel')}
              value={model}
              onChange={(e) => update({ models: { ...s.models, [s.provider]: e.target.value } })}
            />
          </Row>
          <label className="rnd-consent">
            <input
              type="checkbox"
              checked={s.paidOk}
              onChange={(e) => update({ paidOk: e.target.checked })}
            />
            <span>{t('paidOk')}</span>
          </label>
          {!hasKey && <p className="rnd-warn">{t('needKey')}</p>}
        </div>
      </div>
    </Dialog>
  );
}
