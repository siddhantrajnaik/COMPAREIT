import webpush from 'web-push';
import { config } from '../config.js';
import { db, addAlert } from '../db.js';
import { bus } from './bus.js';

let ready = false;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  ready = true;
} else {
  console.warn('[push] VAPID keys missing — run `npm run keys`. In-app alerts still work.');
}

export const pushReady = () => ready;

/**
 * Fan an alert out three ways: persist it, stream it to any open tab (SSE),
 * and fire a real Web Push so it reaches your phone's lock screen even when
 * the PWA is closed. The push is the part that makes this actually useful.
 */
export async function notify({ kind, title, body, url, watchId, productId, payload }) {
  const id = addAlert({ kind, title, body, watchId, productId, payload });

  bus.emit('alert', { id, kind, title, body, url, payload, ts: Date.now() });

  if (!ready) return id;

  const subs = db.prepare('SELECT endpoint, sub FROM push_sub').all();
  const msg = JSON.stringify({
    title,
    body,
    url: url || '/',
    kind,
    tag: `${kind}:${productId || id}`,
    ts: Date.now(),
  });

  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.sub), msg, { TTL: 900, urgency: 'high' });
    } catch (err) {
      // 404/410 mean the browser dropped the subscription — clean it up.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare('DELETE FROM push_sub WHERE endpoint = ?').run(row.endpoint);
      } else {
        console.warn('[push] send failed:', err?.statusCode, err?.message);
      }
    }
  }));

  return id;
}
