import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerConfig } from './config.js';

export const VERSION = '0.1.0';

/** HTTP app without the static file handler (testable without a file system). */
export function createApi(config: ServerConfig): Hono {
  const app = new Hono();
  if (config.allowedOrigins.length) app.use('/api/*', cors({ origin: config.allowedOrigins }));
  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));
  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('Not found', 404),
  );
  return app;
}
