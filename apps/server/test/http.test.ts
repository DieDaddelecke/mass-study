import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCache, GeoHttp, Throttle, UpstreamError, type FetchLike } from '../src/geo/http.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'kubatur-cache-'));
  dirs.push(d);
  return d;
}

describe('FileCache via GeoHttp', () => {
  it('hits, misses and expires', async () => {
    let now = 1_000_000;
    let count = 0;
    const fetchFn: FetchLike = async () => new Response(JSON.stringify({ n: ++count }));
    const cache = new FileCache(tmp(), 1000, () => now);
    const http = new GeoHttp(fetchFn, 'ua', cache);
    expect(await http.getJson('https://x/a', { upstream: 't' })).toEqual({ n: 1 });
    expect(await http.getJson('https://x/a', { upstream: 't' })).toEqual({ n: 1 }); // hit
    expect(await http.getJson('https://x/b', { upstream: 't' })).toEqual({ n: 2 }); // miss
    // POST body is part of the key
    expect(await http.getJson('https://x/a', { upstream: 't', method: 'POST', body: 'q' })).toEqual(
      { n: 3 },
    );
    now += 1001;
    expect(await http.getJson('https://x/a', { upstream: 't' })).toEqual({ n: 4 }); // expired
  });

  it('does not cache failures and maps them to UpstreamError', async () => {
    let status = 500;
    const fetchFn: FetchLike = async () => new Response('{"ok":1}', { status });
    const http = new GeoHttp(fetchFn, 'ua', new FileCache(tmp(), 1e9));
    await expect(http.getJson('https://x/a', { upstream: 't' })).rejects.toBeInstanceOf(
      UpstreamError,
    );
    status = 200;
    expect(await http.getJson('https://x/a', { upstream: 't' })).toEqual({ ok: 1 });
  });

  it('maps network errors and invalid JSON', async () => {
    const boom: FetchLike = async () => {
      throw new Error('timeout');
    };
    await expect(new GeoHttp(boom, 'ua').getJson('https://x', { upstream: 't' })).rejects.toThrow(
      /timeout/,
    );
    const html: FetchLike = async () => new Response('<html>');
    await expect(new GeoHttp(html, 'ua').getJson('https://x', { upstream: 't' })).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it('passes an abort signal (timeout)', async () => {
    let signal: AbortSignal | null | undefined;
    const f: FetchLike = async (_u, init) => {
      signal = init?.signal;
      return new Response('{}');
    };
    await new GeoHttp(f, 'ua').getJson('https://x', { upstream: 't' });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('Throttle', () => {
  it('spaces calls by the interval', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const t = new Throttle(
      1000,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => t.run(async () => starts.push(now))));
    expect(starts).toEqual([0, 1000, 2000]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('keeps going after a failing call', async () => {
    const t = new Throttle(0);
    await expect(t.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await t.run(async () => 42)).toBe(42);
  });
});
