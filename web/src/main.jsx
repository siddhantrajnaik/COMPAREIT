import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The plugin injects a virtual module that registers the service worker.
// Wrapped because it doesn't exist in some dev configurations.
import('virtual:pwa-register')
  .then(({ registerSW }) => registerSW({ immediate: true }))
  .catch(() => {});

// The service worker calls skipWaiting/claim, so a new version can take control
// while an old bundle is still on screen — which shows stale prices and stale
// UI after every update. Reload exactly once when that handover happens.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
