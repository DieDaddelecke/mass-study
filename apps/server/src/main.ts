import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApi } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApi(config);
app.use('/*', serveStatic({ root: config.staticDir }));
// SPA fallback
app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Kubatur server listening on http://localhost:${info.port}`);
});
