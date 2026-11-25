/**
 * AI rendering contract (`/api/render*`), mirrored in apps/web/src/api/contract.ts.
 * The server only forwards one request to the chosen image provider; it stores nothing.
 */

export type RenderProviderId = 'stability' | 'openai' | 'gemini';
export const RENDER_PROVIDERS: readonly RenderProviderId[] = ['stability', 'openai', 'gemini'];

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
}

export interface RenderResponse {
  /** `data:image/…;base64,…` */
  image: string;
  provider: RenderProviderId;
  model: string;
}
