import { db } from '../db.js';
import { config } from '../config.js';
import { searchAll } from '../adapters/index.js';
import { checkWatchRules, evaluateOffer } from './deals.js';
import { notify } from './push.js';
import { bus } from './bus.js';
import { sleep } from '../browser.js';

/**
 * The background heartbeat. Every cycle: re-price every active watch across the
 * platforms it cares about, apply that watch's rules, and separately surface
 * anything that qualifies as a genuinely good deal even if no rule asked for it.
 */

let running = false;
let timer = null;
let lastRun = null;

export function pollerStatus() {
  return { running, lastRun, intervalMs: config.pollIntervalMs, nextRun: lastRun ? lastRun + config.pollIntervalMs : null };
}

const lastPriceStmt = () => db.prepare(
  'SELECT price, mrp, in_stock, ts FROM price_point WHERE product_id = ? ORDER BY ts DESC LIMIT 1 OFFSET 1'
);

export async function runCycle({ watchId = null } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  bus.emit('poll', { state: 'start', ts: Date.now() });

  const summary = { watches: 0, offers: 0, alerts: 0, errors: [] };

  try {
    const watches = watchId
      ? db.prepare('SELECT * FROM watch WHERE id = ? AND active = 1').all(watchId)
      : db.prepare('SELECT * FROM watch WHERE active = 1').all();

    const prevStmt = lastPriceStmt();

    for (const w of watches) {
      summary.watches++;
      const platforms = w.platforms ? w.platforms.split(',').filter(Boolean) : null;

      let results;
      try {
        results = await searchAll(w.query, { platforms });
      } catch (err) {
        summary.errors.push({ watch: w.id, error: err.message });
        continue;
      }

      const offers = results.flatMap((r) => r.offers);
      summary.offers += offers.length;

      // Keep the watch pinned to one product family once we've seen it, so a
      // search for "amul butter" doesn't start alerting about butter cookies.
      const relevant = w.match_key
        ? offers.filter((o) => o.matchKey === w.match_key)
        : offers;
      const pool = relevant.length ? relevant : offers;

      for (const offer of pool) {
        // recordOffer() already inserted the current point during searchAll,
        // so "previous" is the row one step back.
        const prev = prevStmt.get(offer.id) || null;

        for (const hit of checkWatchRules(w, offer, prev)) {
          summary.alerts++;
          await notify({
            ...hit,
            watchId: w.id,
            productId: offer.id,
            url: offer.url,
            payload: { platform: offer.platform, price: offer.price, mrp: offer.mrp, name: offer.name },
          });
        }

        // Unprompted "this is genuinely cheap right now" signal.
        const eva = evaluateOffer(offer, prev);
        if (eva.isDeal && eva.score >= 55 && offer.inStock) {
          const already = db.prepare(
            `SELECT 1 FROM alert WHERE product_id = ? AND kind = 'drop' AND ts > ?`
          ).get(offer.id, Date.now() - 12 * 3600 * 1000);
          if (!already) {
            summary.alerts++;
            await notify({
              kind: 'drop',
              title: `${offer.name} — ₹${offer.price}`,
              body: `${eva.signals.map((s) => s.text).join(', ')} on ${offer.platform}.`,
              watchId: w.id,
              productId: offer.id,
              url: offer.url,
              payload: { platform: offer.platform, price: offer.price, score: eva.score },
            });
          }
        }
      }

      db.prepare('UPDATE watch SET last_checked = ? WHERE id = ?').run(Date.now(), w.id);
      bus.emit('watch-updated', { id: w.id });
      await sleep(500);
    }
  } finally {
    running = false;
    lastRun = Date.now();
    bus.emit('poll', { state: 'done', ts: lastRun, summary });
  }

  return summary;
}

export function startPoller() {
  if (timer) return;
  // Give the server a moment to settle before the first heavy browser launch.
  setTimeout(() => { runCycle().catch((e) => console.error('[poller]', e)); }, 20000);
  timer = setInterval(() => {
    runCycle().catch((e) => console.error('[poller]', e));
  }, config.pollIntervalMs);
}

export function stopPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}
