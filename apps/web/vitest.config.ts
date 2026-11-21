import { createRequire } from 'node:module';
import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

export default defineProject({
  plugins: [react()],
  // svg2pdf.js imports `jsPDF` from the ES build; the Node build of jspdf (picked by the "node"
  // export condition) does not interoperate with it, so tests use the browser ES build in jsdom.
  resolve: {
    alias: [{ find: /^jspdf$/, replacement: require.resolve('jspdf/dist/jspdf.es.min.js') }],
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    server: { deps: { inline: ['svg2pdf.js', 'jspdf'] } },
  },
});
