import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Namespaces (one JSON file per namespace and language, owned by one module):
 *   common     – shared words, units, usages, typologies, KPI names
 *   shell      – ribbon, palettes, browser, status bar, dialogs (apps/web/src/shell)
 *   viewport   – 3D view, nav cube, tools, snapping (apps/web/src/viewport)
 *   newProject – "Nouveau projet" dialog, map, import (apps/web/src/newProject)
 * French is the default language.
 */
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = /\.\/locales\/(\w+)\/(\w+)\.json$/.exec(path);
  if (!m) continue;
  const [, lng, ns] = m as unknown as [string, string, string];
  (resources[lng] ??= {})[ns] = mod.default;
}

export const LANGUAGES = ['fr', 'de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

void i18n.use(initReactI18next).init({
  resources,
  lng: 'fr',
  fallbackLng: 'fr',
  ns: ['common', 'shell', 'viewport', 'newProject'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

/** de-DE / fr-FR number formatting follows the UI language. */
export function numberLocale(lng: string = i18n.language): string {
  return lng === 'de' ? 'de-DE' : lng === 'en' ? 'en-GB' : 'fr-FR';
}

export function formatNumber(v: number, digits = 2, lng?: string): string {
  return new Intl.NumberFormat(numberLocale(lng), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}
