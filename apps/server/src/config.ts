import { OVERPASS_URLS } from './geo/osm.js';
import type { WfsParcelConfig } from './geo/wfs-parcel.js';
import type { RenderProviderId } from './render/contract.js';

/** Runtime configuration from environment variables (see README / docker-compose.yml). */
export interface ServerConfig {
  port: number;
  /** Directory with the built web app (served at /). */
  staticDir: string;
  /** Cache directory for geodata responses. */
  dataDir: string;
  cacheTtlDays: number;
  userAgent: string;
  allowedOrigins: string[];
  /** Generic WFS cadastre providers (JSON array in PARCEL_WFS), none by default. */
  wfsParcelProviders: WfsParcelConfig[];
  /** Overpass endpoints tried in order on 429/5xx (OVERPASS_URLS, comma separated). */
  overpassUrls: string[];
  /**
   * Server-side API keys for the AI rendering (RENDER_STABILITY_KEY, RENDER_OPENAI_KEY,
   * RENDER_GEMINI_KEY, RENDER_OPENROUTER_KEY). Optional: users can enter their own key in the app instead.
   */
  renderKeys: Partial<Record<RenderProviderId, string>>;
}

/** Default port outside Docker; 8080 is often taken (Docker Desktop, WSL). The image sets PORT=8080. */
export const DEFAULT_PORT = 8787;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    staticDir: env.STATIC_DIR ?? '../web/dist',
    dataDir: env.DATA_DIR ?? './data',
    cacheTtlDays: Number(env.CACHE_TTL_DAYS ?? 30),
    userAgent: env.USER_AGENT ?? 'Kubatur/0.1 (massing study tool)',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    wfsParcelProviders: parseWfsConfig(env.PARCEL_WFS),
    overpassUrls: parseList(env.OVERPASS_URLS, OVERPASS_URLS),
    renderKeys: {
      stability: env.RENDER_STABILITY_KEY?.trim() || undefined,
      openai: env.RENDER_OPENAI_KEY?.trim() || undefined,
      gemini: env.RENDER_GEMINI_KEY?.trim() || undefined,
      openrouter: env.RENDER_OPENROUTER_KEY?.trim() || undefined,
    },
  };
}

function parseList(raw: string | undefined, def: string[]): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : def;
}

function parseWfsConfig(raw: string | undefined): WfsParcelConfig[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('PARCEL_WFS must be a JSON array');
  for (const c of parsed as Partial<WfsParcelConfig>[]) {
    if (!c.id || !c.url || !c.typeName || !c.fields?.ref || c.coverage?.length !== 4) {
      throw new Error('PARCEL_WFS entry needs id, url, typeName, coverage[4], fields.ref');
    }
  }
  return parsed as WfsParcelConfig[];
}
