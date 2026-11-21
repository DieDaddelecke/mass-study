import {
  API,
  type ApiError,
  type ContextLayersResponse,
  type ContextResponse,
  type GeocodeResponse,
  type ParcelsResponse,
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
