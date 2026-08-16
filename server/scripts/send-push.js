#!/usr/bin/env node
/**
 * Sends the alerts a scrape run produced, from inside GitHub Actions.
 *
 * A static site has no backend to hold push subscriptions, so the subscription
 * lives in a repo secret instead. The flow is deliberately manual and explicit:
 * you enable push in the app, it shows you the subscription JSON, you paste it
 * into a secret. Nothing is transmitted anywhere you didn't put it yourself.
 *
 * Required secrets:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (from `npm run keys`)
 *   PUSH_SUBSCRIPTION                     one subscription JSON, or an array
 *
 * Absent secrets are not an error — the site still works, it just stays quiet.
 */
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { ROOT } from '../src/config.js';

const queuePath = path.join(ROOT, '.push-queue.json');
let queue = [];
try { queue = JSON.parse(fs.readFileSync(queuePath, 'utf8')); } catch { /* nothing queued */ }

if (!queue.length) { console.log('No alerts to send.'); process.exit(0); }

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTION } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.log(`${queue.length} alert(s) fired, but VAPID keys are not configured — skipping push.`);
  process.exit(0);
}
if (!PUSH_SUBSCRIPTION) {
  console.log(`${queue.length} alert(s) fired, but PUSH_SUBSCRIPTION is not set — skipping push.`);
  process.exit(0);
}

webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subs;
try {
  const parsed = JSON.parse(PUSH_SUBSCRIPTION);
  subs = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  console.error('PUSH_SUBSCRIPTION is not valid JSON — skipping push.');
  process.exit(0);
}

// A run that finds twelve drops shouldn't fire twelve notifications. Send the
// best few individually, then one summary for the rest.
const TOP = 3;
const ranked = [...queue].sort((a, b) => (b.score || 0) - (a.score || 0));
const head = ranked.slice(0, TOP);
const rest = ranked.length - head.length;

const messages = head.map((a) => ({
  title: a.title,
  body: a.body,
  url: a.url || '',
  kind: a.kind,
  tag: `${a.kind}:${a.productId}`,
  ts: a.ts,
}));

if (rest > 0) {
  messages.push({
    title: `${rest} more price ${rest === 1 ? 'change' : 'changes'}`,
    body: 'Open QuickCompare to see the rest.',
    url: '', kind: 'summary', tag: 'summary', ts: Date.now(),
  });
}

let sent = 0, failed = 0, gone = 0;
for (const sub of subs) {
  for (const msg of messages) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        gone++;   // the browser dropped it; re-enable push in the app
      } else {
        failed++;
        console.warn('push failed:', err?.statusCode, (err?.message || '').slice(0, 80));
      }
    }
  }
}

console.log(`Push: ${sent} sent, ${failed} failed, ${gone} expired (of ${queue.length} alerts).`);
if (gone) console.log('An expired subscription means you need to re-enable push and update the secret.');
process.exit(0);
