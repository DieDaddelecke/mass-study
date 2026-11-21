import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server listens on PORT (default 8787, see apps/server/src/config.ts). 127.0.0.1 instead of
// localhost: on Windows localhost resolves to ::1, where Docker Desktop / WSL often hold ports.
const apiPort = process.env.PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
});
