// Screenshot helper for development (uses the pre-installed Playwright + Chromium).
// Usage: node apps/web/scripts/screenshot.mjs <url> <out.png> [width] [height]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node-tools/node_modules/playwright');
}
const [url, out, w = '1600', h = '900'] = process.argv.slice(2);
const browser = await pw.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
console.log('saved', out);
