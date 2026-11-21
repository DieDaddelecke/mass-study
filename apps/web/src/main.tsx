import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import './i18n';
import { App } from './App';
import './theme/tokens.css';
import './styles.css';
import { actions, useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';

// Development only: stores on window for end-to-end checks.
if (import.meta.env.DEV)
  (window as unknown as Record<string, unknown>).__kubatur = {
    actions,
    useProjectStore,
    useUiStore,
  };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
