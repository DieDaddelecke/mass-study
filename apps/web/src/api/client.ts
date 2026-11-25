import {
  API,
  type ApiError,
  type ContextLayersResponse,
  type ContextResponse,
  type GeocodeResponse,
  type ParcelsResponse,
  type RenderApiError,
  type RenderProvidersResponse,
  type RenderRequest,
  type RenderResponse,
} from './contract';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* not json */
    }
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  geocode: (q: string, signal?: AbortSignal) =>
    getJson<GeocodeResponse>(`${API.geocode}?${qs({ q, limit: 5 })}`, signal),
  complete: (q: string, signal?: AbortSignal) =>
    getJson<GeocodeResponse>(`${API.geocodeComplete}?${qs({ q })}`, signal),
  parcelsAt: (lon: number, lat: number, signal?: AbortSignal) =>
    getJson<ParcelsResponse>(`${API.parcels}?${qs({ lon, lat })}`, signal),
  context: (bbox: [number, number, number, number], signal?: AbortSignal) =>
    getJson<ContextResponse>(`${API.context}?${qs({ bbox: bbox.join(',') })}`, signal),
  contextLayers: (bbox: [number, number, number, number], signal?: AbortSignal) =>
    getJson<ContextLayersResponse>(`${API.contextLayers}?${qs({ bbox: bbox.join(',') })}`, signal),
};

export class RenderRequestError extends Error {
  constructor(
    public status: number,
    public body: RenderApiError | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

export const renderApi = {
  providers: (signal?: AbortSignal) =>
    getJson<RenderProvidersResponse>(API.renderProviders, signal),
  /** Paid call: only on an explicit user action. */
  render: async (
    req: RenderRequest,
    key: string,
    signal?: AbortSignal,
  ): Promise<RenderResponse> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key.trim()) headers['X-Render-Key'] = key.trim();
    const res = await fetch(API.render, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      let body: RenderApiError | null = null;
      try {
        body = (await res.json()) as RenderApiError;
      } catch {
        /* not json */
      }
      throw new RenderRequestError(res.status, body);
    }
    return (await res.json()) as RenderResponse;
  },
};
