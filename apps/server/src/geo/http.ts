import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Minimal fetch signature so tests can inject recorded responses. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Raised when an upstream geodata service fails (→ HTTP 502). */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly upstream: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialises calls so that two starts are at least `intervalMs` apart. */
export class Throttle {
  private next = 0;
  private chain: Promise<void> = Promise.resolve();
  constructor(
    readonly intervalMs: number,
    private readonly now: Clock = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const slot = this.chain.then(async () => {
      const wait = this.next - this.now();
      if (wait > 0) await this.sleep(wait);
      this.next = this.now() + this.intervalMs;
    });
    this.chain = slot.catch(() => undefined);
    return slot.then(fn);
  }
}

interface CacheEntry {
  storedAt: number;
  body: string;
}

/** File-system cache of upstream response bodies. Key = sha256(method + URL + body). */
export class FileCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  static key(method: string, url: string, body = ''): string {
    return createHash('sha256').update(`${method}\n${url}\n${body}`).digest('hex');
  }

  private file(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as CacheEntry;
      if (typeof entry.storedAt !== 'number' || typeof entry.body !== 'string') return undefined;
      if (this.now() - entry.storedAt > this.ttlMs) return undefined;
      return entry.body;
    } catch {
      return undefined;
    }
  }

  async set(key: string, body: string): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const entry: CacheEntry = { storedAt: this.now(), body };
      await writeFile(this.file(key), JSON.stringify(entry));
    } catch {
      // cache is best effort
    }
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
  throttle?: Throttle;
  /** Name used in error messages. */
  upstream: string;
}

/** Upstream HTTP client: User-Agent, timeout, optional throttle and file cache. */
export class GeoHttp {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly userAgent: string,
    private readonly cache?: FileCache,
    private readonly timeoutMs = 10_000,
  ) {}

  async getJson(url: string, opts: RequestOptions): Promise<unknown> {
    const method = opts.method ?? 'GET';
    const key = FileCache.key(method, url, opts.body);
    const cached = await this.cache?.get(key);
    if (cached !== undefined) return JSON.parse(cached) as unknown;

    const doFetch = async (): Promise<string> => {
      const headers: Record<string, string> = {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      };
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers,
          body: opts.body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new UpstreamError(`${opts.upstream}: request failed (${msg})`, opts.upstream);
      }
      if (!res.ok) {
        throw new UpstreamError(`${opts.upstream}: HTTP ${res.status}`, opts.upstream, res.status);
      }
      return res.text();
    };
    const text = opts.throttle ? await opts.throttle.run(doFetch) : await doFetch();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new UpstreamError(`${opts.upstream}: invalid JSON`, opts.upstream);
    }
    await this.cache?.set(key, text);
    return parsed;
  }
}
