// Screenshot helper for development (uses the pre-installed Playwright + Chromium).
// Usage: node apps/web/scripts/screenshot.mjs <url> <out.png> [width] [height] [theme]
// theme (optional): light | dark | system – stored as localStorage 'kubatur.theme' before load.
// Or append ?theme=dark to the URL.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node-tools/node_modules/playwright');
}
const [url, out, w = '1600', h = '900', theme] = process.argv.slice(2);
const browser = await pw.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
if (theme) await page.addInitScript((t) => localStorage.setItem('kubatur.theme', t), theme);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);
// Optional: SHOT_KEYS="Control+k,d,e" presses keys; SHOT_TYPE types text afterwards.
for (const k of (process.env.SHOT_KEYS ?? '').split(',').filter(Boolean)) {
  await page.keyboard.press(k);
  await page.waitForTimeout(150);
}
if (process.env.SHOT_TYPE) await page.keyboard.type(process.env.SHOT_TYPE, { delay: 40 });
// SHOT_CLICK='css selector' clicks an element (e.g. a dock button).
if (process.env.SHOT_CLICK) await page.click(process.env.SHOT_CLICK);
if (process.env.SHOT_KEYS || process.env.SHOT_TYPE || process.env.SHOT_CLICK)
  await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
console.log('saved', out);
