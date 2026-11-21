import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from '../src/geo/http.js';

const FIX = join(import.meta.dirname, 'fixtures');

export function fixture(path: string): string {
  return readFileSync(join(FIX, path), 'utf8');
}

export interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** Fake fetch answering by the first matching route (substring of URL). */
export function fakeFetch(routes: [match: string, file: string | number][]): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = routes.find(([m]) => url.includes(m));
    if (!r) return new Response('no route', { status: 404 });
    const [, target] = r;
    if (typeof target === 'number') return new Response('err', { status: target });
    return new Response(fixture(target), { status: 200 });
  };
  return { fetch, calls };
}
