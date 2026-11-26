import type { FetchLike } from '../geo/http.js';
import type { RenderProviderId, RenderRequest, RenderResponse } from './contract.js';

/**
 * Image-to-image providers for the AI rendering of the 3D view. Each adapter sends the screenshot
 * plus the prompt and returns one image. Keys come from the caller (header) or the server env.
 */

export const DEFAULT_MODELS: Record<RenderProviderId, string> = {
  // Stable Image Control "structure": ControlNet-like, keeps the edges of the input image.
  stability: 'structure',
  openai: 'gpt-image-1',
  gemini: 'gemini-2.5-flash-image',
  // One key for many models (Gemini, GPT Image, Flux, …); the model id carries the vendor.
  openrouter: 'google/gemini-nano-banana-2.1',
};

/** Max. upstream time for one rendering. */
export const RENDER_TIMEOUT_MS = 180_000;
/** Max. size of the decoded input image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 4000;

export class RenderError extends Error {
  constructor(
    public status: number,
    public code:
      | 'bad_request'
      | 'no_key'
      | 'invalid_key'
      | 'payment_required'
      | 'rate_limited'
      | 'upstream_error'
      | 'blocked',
    message: string,
  ) {
    super(message);
  }
}

export interface DecodedImage {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array<ArrayBuffer>;
}

export function decodeDataUrl(url: string): DecodedImage {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m) throw new RenderError(400, 'bad_request', 'image must be a png/jpeg/webp data URL');
  const bytes = new Uint8Array(Buffer.from(m[2]!, 'base64'));
  if (bytes.length < 100) throw new RenderError(400, 'bad_request', 'image is empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new RenderError(400, 'bad_request', 'image too large');
  return { mime: m[1] as DecodedImage['mime'], bytes };
}

const ext = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]);

/** Upstream HTTP error → RenderError with the provider's own message (shortened). */
async function upstreamError(provider: string, res: Response): Promise<RenderError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as {
        error?:
          { message?: string; metadata?: { limit_source?: string; reason?: string } } | string;
        errors?: string[];
        message?: string;
      };
      detail =
        (typeof j.error === 'string' ? j.error : j.error?.message) ??
        j.errors?.join('; ') ??
        j.message ??
        text;
      // OpenRouter says which limit refused the request (key limit, credits, in-flight budget)
      const meta = typeof j.error === 'object' ? j.error?.metadata : undefined;
      const why = [meta?.limit_source, meta?.reason].filter(Boolean).join(', ');
      if (why) detail += ` [${why}]`;
    } catch {
      detail = text;
    }
  } catch {
    /* no body */
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  const msg = `${provider} ${res.status}${detail ? `: ${detail}` : ''}`;
  if (res.status === 401 || res.status === 403) return new RenderError(401, 'invalid_key', msg);
  if (res.status === 402) return new RenderError(402, 'payment_required', msg);
  if (res.status === 429) return new RenderError(429, 'rate_limited', msg);
  if (res.status === 400 || res.status === 422) return new RenderError(400, 'bad_request', msg);
  return new RenderError(502, 'upstream_error', msg);
}

function toDataUrl(mime: string, bytes: Uint8Array | string): string {
  const b64 = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export interface ProviderCall {
  req: RenderRequest;
  model: string;
  image: DecodedImage;
  guide?: DecodedImage;
  seed?: number;
  key: string;
  fetch: FetchLike;
}

async function stability({ req, model, image, seed, key, fetch }: ProviderCall): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([image.bytes], { type: image.mime }), `view.${ext(image.mime)}`);
  form.append('prompt', req.prompt);
  if (req.negativePrompt) form.append('negative_prompt', req.negativePrompt);
  form.append('control_strength', String(clamp01(req.fidelity ?? 0.7)));
  form.append('output_format', 'png');
  if (seed !== undefined) form.append('seed', String(seed));
  const res = await fetch(`https://api.stability.ai/v2beta/stable-image/control/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Accept: 'image/*' },
    body: form,
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  if (!res.ok) throw await upstreamError('Stability AI', res);
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return toDataUrl(mime, new Uint8Array(await res.arrayBuffer()));
}

/** gpt-image sizes: landscape, portrait or square, whichever is closest to the view. */
export function openAiSize(aspect: number | undefined): string {
  if (!aspect || !Number.isFinite(aspect)) return 'auto';
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 1 / 1.2) return '1024x1536';
  return '1024x1024';
}

async function openai({ req, model, image, key, fetch }: ProviderCall): Promise<string> {
  const form = new FormData();
  form.append('model', model);
  form.append('image', new Blob([image.bytes], { type: image.mime }), `view.${ext(image.mime)}`);
  const neg = req.negativePrompt ? `\nAvoid: ${req.negativePrompt}` : '';
  form.append('prompt', req.prompt + neg);
  form.append('size', openAiSize(req.aspect));
  form.append('quality', 'medium');
  form.append('n', '1');
  // gpt-image-1 keeps the input closer with input_fidelity=high.
  if (model === 'gpt-image-1' && (req.fidelity ?? 0.7) >= 0.5)
    form.append('input_fidelity', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  if (!res.ok) throw await upstreamError('OpenAI', res);
  const j = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new RenderError(502, 'upstream_error', 'OpenAI: no image in the response');
  return toDataUrl('image/png', b64);
}

const GEMINI_RATIOS: [string, number][] = [
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
];

/** Closest aspect ratio Gemini accepts. */
export function geminiRatio(aspect: number): string {
  let best = GEMINI_RATIOS[0]!;
  for (const r of GEMINI_RATIOS)
    if (Math.abs(Math.log(r[1] / aspect)) < Math.abs(Math.log(best[1] / aspect))) best = r;
  return best[0];
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

async function gemini({
  req,
  model,
  image,
  guide,
  seed,
  key,
  fetch,
}: ProviderCall): Promise<string> {
  const neg = req.negativePrompt ? `\nAvoid: ${req.negativePrompt}` : '';
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: req.prompt + neg },
          {
            inline_data: {
              mime_type: image.mime,
              data: Buffer.from(image.bytes).toString('base64'),
            },
          },
          ...(guide
            ? [
                {
                  inline_data: {
                    mime_type: guide.mime,
                    data: Buffer.from(guide.bytes).toString('base64'),
                  },
                },
              ]
            : []),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(seed !== undefined ? { seed } : {}),
      ...(req.aspect && Number.isFinite(req.aspect)
        ? { imageConfig: { aspectRatio: geminiRatio(req.aspect) } }
        : {}),
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw await upstreamError('Gemini', res);
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const d = p.inlineData ?? p.inline_data;
    const mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png';
    if (d?.data) return toDataUrl(mime, d.data);
  }
  const reason =
    j.promptFeedback?.blockReason ??
    j.candidates?.[0]?.finishReason ??
    parts.find((p) => p.text)?.text?.slice(0, 200);
  throw new RenderError(
    j.promptFeedback?.blockReason ? 422 : 502,
    j.promptFeedback?.blockReason ? 'blocked' : 'upstream_error',
    `Gemini: no image in the response${reason ? ` (${reason})` : ''}`,
  );
}

async function openrouter({
  req,
  model,
  image,
  guide,
  seed,
  key,
  fetch,
}: ProviderCall): Promise<string> {
  const neg = req.negativePrompt ? `\nAvoid: ${req.negativePrompt}` : '';
  const body = {
    model,
    prompt: req.prompt + neg,
    input_references: [
      { type: 'image_url', image_url: { url: toDataUrl(image.mime, image.bytes) } },
      ...(guide
        ? [{ type: 'image_url', image_url: { url: toDataUrl(guide.mime, guide.bytes) } }]
        : []),
    ],
    n: 1,
    resolution: RESOLUTIONS.has(req.resolution ?? '') ? req.resolution : '1K',
    ...(seed !== undefined ? { seed } : {}),
    ...(req.aspect && Number.isFinite(req.aspect) ? { aspect_ratio: geminiRatio(req.aspect) } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Kubatur',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  if (!res.ok) throw await upstreamError('OpenRouter', res);
  const j = (await res.json()) as {
    data?: { b64_json?: string; media_type?: string; url?: string }[];
  };
  const d = j.data?.[0];
  if (d?.b64_json) return toDataUrl(d.media_type || 'image/png', d.b64_json);
  if (d?.url?.startsWith('data:image/')) return d.url;
  throw new RenderError(502, 'upstream_error', 'OpenRouter: no image in the response');
}

const ADAPTERS: Record<RenderProviderId, (c: ProviderCall) => Promise<string>> = {
  openrouter,
  stability,
  openai,
  gemini,
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.7));
}

const RESOLUTIONS = new Set<string>(['1K', '2K', '4K']);

const MODEL_RE = /^[A-Za-z0-9][\w.-]{0,79}$/;
/** OpenRouter ids: vendor/model, optional :variant (sent in the body, never in a URL). */
const OPENROUTER_MODEL_RE = /^[A-Za-z0-9][\w.-]{0,40}\/[\w.-]{1,80}(:[\w.-]{1,20})?$/;

/** Validates the request and calls the provider. */
export async function render(
  req: RenderRequest,
  key: string | undefined,
  fetch: FetchLike,
): Promise<RenderResponse> {
  if (!req || typeof req !== 'object' || !(req.provider in ADAPTERS))
    throw new RenderError(400, 'bad_request', 'unknown provider');
  if (typeof req.prompt !== 'string' || !req.prompt.trim())
    throw new RenderError(400, 'bad_request', 'prompt is required');
  if (req.prompt.length > MAX_PROMPT_CHARS)
    throw new RenderError(400, 'bad_request', 'prompt is too long');
  if (req.negativePrompt !== undefined && typeof req.negativePrompt !== 'string')
    throw new RenderError(400, 'bad_request', 'negativePrompt must be a string');
  const model = req.model?.trim() || DEFAULT_MODELS[req.provider];
  const re = req.provider === 'openrouter' ? OPENROUTER_MODEL_RE : MODEL_RE;
  if (!re.test(model)) throw new RenderError(400, 'bad_request', 'invalid model id');
  if (typeof req.image !== 'string') throw new RenderError(400, 'bad_request', 'image is required');
  const image = decodeDataUrl(req.image);
  const guide = typeof req.guide === 'string' && req.guide ? decodeDataUrl(req.guide) : undefined;
  let seed: number | undefined;
  if (req.seed !== undefined && req.seed !== null) {
    if (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 4_294_967_294)
      throw new RenderError(400, 'bad_request', 'seed must be an integer 0–4294967294');
    seed = req.seed;
  }
  if (!key) throw new RenderError(401, 'no_key', `no API key for ${req.provider}`);
  const out = await ADAPTERS[req.provider]({ req, model, image, guide, seed, key, fetch });
  return { image: out, provider: req.provider, model };
}
