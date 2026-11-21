import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApi } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApi(config, { fetch: (url, init) => fetch(url, init) });
app.use('/*', serveStatic({ root: config.staticDir }));
// SPA fallback
app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Kubatur server listening on http://localhost:${info.port}`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. Start with another port, e.g. PORT=8788 pnpm dev ` +
        `(PowerShell: $env:PORT=8788; pnpm dev). The Vite proxy follows PORT.`,
    );
    process.exit(1);
  }
  throw err;
});
