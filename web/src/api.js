import { staticApi } from './staticApi';

/**
 * Two deployments share this UI: the local app (full Node backend) and the
 * GitHub Pages build (scheduled JSON snapshots, no server). The build flag
 * picks which implementation `api` points at, so no component needs to know.
 */
export const IS_STATIC = import.meta.env.VITE_STATIC === '1';

const j = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
};

const get = (u) => fetch(u).then(j);
const send = (m) => (u, body) =>
  fetch(u, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(j);

const post = send('POST');
const patch = send('PATCH');
const del = send('DELETE');

const liveApi = {
  health: () => get('/api/health'),
  cities: () => get('/api/cities'),
  setLocation: (b) => post('/api/location', b),

  search: (q, { platforms, fresh } = {}) => {
    const p = new URLSearchParams({ q });
    if (platforms?.length) p.set('platforms', platforms.join(','));
    if (fresh) p.set('fresh', '1');
    return get(`/api/search?${p}`);
  },

  watches: () => get('/api/watches'),
  addWatch: (b) => post('/api/watches', b),
  updateWatch: (id, b) => patch(`/api/watches/${id}`, b),
  delWatch: (id) => del(`/api/watches/${id}`),
  checkWatch: (id) => post(`/api/watches/${id}/check`),

  history: (pid, days = 30) => get(`/api/history/${encodeURIComponent(pid)}?days=${days}`),

  lists: () => get('/api/lists'),
  addList: (name) => post('/api/lists', { name }),
  renameList: (id, name) => patch(`/api/lists/${id}`, { name }),
  delList: (id) => del(`/api/lists/${id}`),

  basket: (listId) => get(`/api/basket${listId ? `?listId=${listId}` : ''}`),
  addBasket: (b) => post('/api/basket', b),
  updateBasket: (id, b) => patch(`/api/basket/${id}`, b),
  delBasket: (id) => del(`/api/basket/${id}`),
  optimise: (fresh = false, listId) => post('/api/basket/optimise', { fresh, listId }),

  fees: () => get('/api/fees'),
  saveFees: (f) => post('/api/fees', f),
  resetFees: () => post('/api/fees/reset'),

  deals: ({ days = 3, minScore = 20 } = {}) => get(`/api/deals?days=${days}&minScore=${minScore}`),

  alerts: (limit = 50) => get(`/api/alerts?limit=${limit}`),
  markSeen: () => post('/api/alerts/seen'),
  clearAlerts: () => del('/api/alerts'),

  subscribe: (sub) => post('/api/push/subscribe', sub),
  unsubscribe: (endpoint) => post('/api/push/unsubscribe', { endpoint }),
  testPush: () => post('/api/push/test'),

  rescueStatus: () => get('/api/rescue/status'),
  rescueCheck: () => post('/api/rescue/check'),
  rescueToggle: (enabled) => post('/api/rescue/toggle', { enabled }),

  poller: () => get('/api/poller'),
  pollRun: () => post('/api/poller/run'),
  pollToggle: (enabled) => post('/api/poller/toggle', { enabled }),

  diagnostics: () => get('/api/diagnostics'),
};

export const api = IS_STATIC ? staticApi : liveApi;

/** base64url -> Uint8Array, required by PushManager.subscribe. */
function urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Register for Web Push. Returns { ok, reason } rather than throwing, because
 * every failure mode here is something the user needs explained (denied
 * permission, insecure origin, iOS not-installed) rather than a stack trace.
 */
export async function enablePush(vapidPublicKey) {
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'No service worker support.' };
  if (!('PushManager' in window)) {
    return {
      ok: false,
      reason: /iPhone|iPad/.test(navigator.userAgent)
        ? 'On iPhone, add this to your Home Screen first — iOS only allows push for installed apps.'
        : 'This browser has no Push API.',
    };
  }
  const key = vapidPublicKey || (IS_STATIC ? import.meta.env.VITE_VAPID_PUBLIC_KEY : null);
  if (!key) {
    return {
      ok: false,
      reason: IS_STATIC
        ? 'No VAPID public key in this build. Set VITE_VAPID_PUBLIC_KEY when building, or run the app locally.'
        : 'Server has no VAPID key. Run `npm run keys` and restart.',
    };
  }
  vapidPublicKey = key;
  if (!window.isSecureContext) {
    return { ok: false, reason: 'Push needs HTTPS or localhost. Over LAN, use the localhost address or a tunnel.' };
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'Notification permission was denied.' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(vapidPublicKey),
    });
  }

  // Static builds have no server to register with. The subscription is handed
  // back for the user to paste into a GitHub secret, which is what the
  // scheduled Action sends through.
  if (IS_STATIC) {
    return { ok: true, manual: true, endpoint: sub.endpoint, subscription: sub.toJSON() };
  }

  await api.subscribe(sub.toJSON());
  return { ok: true, endpoint: sub.endpoint };
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
  return { ok: true };
}

export const money = (n) =>
  n == null ? '—' : '₹' + (Number.isInteger(n) ? n : n.toFixed(2)).toLocaleString('en-IN');

export function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
