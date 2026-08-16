import { withPage } from '../browser.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { notify } from './push.js';
import { bus } from './bus.js';

/**
 * Zomato "Food Rescue" radar.
 *
 * HOW THE REAL FEATURE WORKS: when an order is cancelled after pickup, Zomato
 * offers it at a steep discount to customers within ~3 km of the rider, for a
 * window of a few minutes. There is no public API and no public feed — it is a
 * personalised, authenticated, short-lived surface.
 *
 * WHAT THIS DOES, HONESTLY: it drives YOUR OWN logged-in Zomato session in the
 * local browser profile and re-checks the delivery surface on an interval,
 * looking for rescue cards. Run `npm run login` once to sign in by hand; the
 * session persists in data/browser-profile.
 *
 * LIMITS YOU SHOULD KNOW:
 *  - Zomato pushes this primarily to the mobile app. The web surface shows it
 *    inconsistently, so this will miss some offers.
 *  - The claim window is minutes; a 60s poll can arrive too late.
 *  - This never auto-claims. It notifies you and links straight to the page.
 *
 * The most reliable setup remains: keep Zomato app notifications on, and treat
 * this as a second net rather than the only one.
 */

let timer = null;
let lastCheck = null;
let lastStatus = 'idle';

export function rescueStatus() {
  return {
    enabled: !!timer,
    lastCheck,
    status: lastStatus,
    intervalMs: config.rescue.intervalMs,
  };
}

const SEEN_TTL = 6 * 3600 * 1000;

function alreadySeen(id) {
  db.prepare('DELETE FROM rescue_seen WHERE ts < ?').run(Date.now() - SEEN_TTL);
  const row = db.prepare('SELECT 1 FROM rescue_seen WHERE id = ?').get(id);
  if (row) return true;
  db.prepare('INSERT OR REPLACE INTO rescue_seen (id, ts) VALUES (?, ?)').run(id, Date.now());
  return false;
}

export async function checkRescue() {
  lastCheck = Date.now();
  try {
    const found = await withPage(async (page) => {
      await page.goto('https://www.zomato.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      return page.evaluate(() => {
        const loggedIn = !/\blog\s?in\b/i.test(
          document.querySelector('header')?.textContent || document.body.innerText.slice(0, 3000)
        );

        const hits = [];
        const RE = /food\s*rescue|rescue\s*(this|order|deal)|cancelled order.*(available|grab)/i;

        // Walk reasonably-sized blocks so we capture the card, not the whole page.
        for (const el of document.querySelectorAll('div, section, a, article')) {
          const txt = (el.innerText || '').trim();
          if (txt.length < 15 || txt.length > 600) continue;
          if (!RE.test(txt)) continue;
          // Prefer the tightest element that still matches.
          if ([...el.querySelectorAll('div,section,a,article')].some((c) => RE.test(c.innerText || ''))) continue;

          const priceMatch = txt.match(/₹\s*([\d,]+)/g) || [];
          const link = el.closest('a')?.href || el.querySelector('a')?.href || location.href;
          hits.push({
            text: txt.replace(/\s+/g, ' ').slice(0, 280),
            prices: priceMatch.slice(0, 3),
            link,
          });
        }
        return { loggedIn, hits };
      });
    }, { timeout: 30000 });

    if (!found.loggedIn) {
      lastStatus = 'not-logged-in';
      bus.emit('rescue', { status: lastStatus, ts: lastCheck });
      return { ok: false, reason: 'not-logged-in', hits: [] };
    }

    lastStatus = found.hits.length ? 'hit' : 'clear';

    for (const hit of found.hits) {
      const id = 'rescue:' + Buffer.from(hit.text).toString('base64').slice(0, 48);
      if (alreadySeen(id)) continue;
      await notify({
        kind: 'rescue',
        title: '🍜 Food Rescue nearby',
        body: hit.text.slice(0, 160),
        url: hit.link,
        payload: { prices: hit.prices, source: 'zomato' },
      });
    }

    bus.emit('rescue', { status: lastStatus, count: found.hits.length, ts: lastCheck });
    return { ok: true, hits: found.hits };
  } catch (err) {
    lastStatus = 'error';
    bus.emit('rescue', { status: lastStatus, error: err.message, ts: lastCheck });
    return { ok: false, reason: err.message, hits: [] };
  }
}

export function startRescue() {
  if (timer) return;
  timer = setInterval(() => { checkRescue().catch(() => {}); }, config.rescue.intervalMs);
  checkRescue().catch(() => {});
}

export function stopRescue() {
  if (timer) clearInterval(timer);
  timer = null;
  lastStatus = 'idle';
}
