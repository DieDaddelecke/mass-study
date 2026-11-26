/**
 * AI rendering contract (`/api/render*`), mirrored in apps/web/src/api/contract.ts.
 * The server only forwards one request to the chosen image provider; it stores nothing.
 */

export type RenderProviderId = 'gemini' | 'openrouter' | 'stability' | 'openai';
export const RENDER_PROVIDERS: readonly RenderProviderId[] = [
  'gemini',
  'openrouter',
  'stability',
  'openai',
];

/** GET /api/render/providers → which providers have a key configured on the server. */
export interface RenderProvidersResponse {
  providers: { id: RenderProviderId; serverKey: boolean; defaultModel: string }[];
}

/**
 * POST /api/render. The API key travels in the `X-Render-Key` header (never in the body, never
 * logged); without it the server key of the provider (env) is used.
 */
export interface RenderRequest {
  provider: RenderProviderId;
  /** Provider model id; default per provider. */
  model?: string;
  prompt: string;
  negativePrompt?: string;
  /** Screenshot of the 3D view, `data:image/png;base64,…` or jpeg. */
  image: string;
  /** How strictly the geometry of the image is kept, 0–1 (Stability control_strength). */
  fidelity?: number;
  /** Width / height of the view (picks the output format). */
  aspect?: number;
  /** Line drawing of the view (data URL), sent as a second image where the provider allows it. */
  guide?: string;
  /** Fixed seed (0 – 4 294 967 294) for series from the same view. */
  seed?: number;
  /**
   * Output size tier (OpenRouter). Without it OpenRouter reserves the most expensive size up
   * front, which can exceed a small credit even though one image costs a few cents.
   */
  resolution?: RenderResolution;
}

export type RenderResolution = '1K' | '2K' | '4K';
export const RENDER_RESOLUTIONS: readonly RenderResolution[] = ['1K', '2K', '4K'];

export interface RenderResponse {
  /** `data:image/…;base64,…` */
  image: string;
  provider: RenderProviderId;
  model: string;
}
