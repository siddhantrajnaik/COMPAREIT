/* Service worker: offline shell + Web Push.
 *
 * The push handler is the reason this app is a PWA at all — it's what lets a
 * price drop or a food rescue reach your lock screen while the app is closed.
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Never cache the API or the scheduled data files — stale prices are worse
// than no prices, and the static build's JSON is refreshed on every deploy.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ error: 'offline' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      })
    ));
  }
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'QuickCompare', body: event.data?.text?.() || '' }; }

  const isRescue = d.kind === 'rescue';
  const options = {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/badge.png',
    tag: d.tag || d.kind || 'quickcompare',
    renotify: true,
    // Rescues expire in minutes — make them demand attention. Price drops don't.
    requireInteraction: isRescue,
    vibrate: isRescue ? [200, 80, 200, 80, 200] : [120, 60, 120],
    timestamp: d.ts || Date.now(),
    data: { url: d.url || '/', kind: d.kind },
    actions: [
      { action: 'open', title: isRescue ? 'Grab it' : 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(d.title || 'QuickCompare', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open window when there is one; opening a fourth tab is rude.
      for (const c of list) {
        if ('focus' in c) { c.navigate?.(target); return c.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
