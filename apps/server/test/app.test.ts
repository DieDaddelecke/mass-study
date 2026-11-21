import { describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('server api', () => {
  const app = createApi(loadConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' }));

  it('answers health checks', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('reads configuration from the environment', () => {
    const c = loadConfig({ PORT: '9000', ALLOWED_ORIGINS: 'a, b' });
    expect(c.port).toBe(9000);
    expect(c.allowedOrigins).toEqual(['a', 'b']);
    expect(c.cacheTtlDays).toBe(30);
  });
});
