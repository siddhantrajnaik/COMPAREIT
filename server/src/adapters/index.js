import { blinkit } from './blinkit.js';
import { zepto } from './zepto.js';
import { instamart } from './instamart.js';
import { bigbasket } from './bigbasket.js';
import { dmart } from './dmart.js';
import { flipkart } from './flipkart.js';
import { jiomart } from './jiomart.js';
import { config } from '../config.js';
import { logScrape, recordOffer } from '../db.js';
import { sleep } from '../browser.js';

export const ALL_ADAPTERS = { blinkit, zepto, instamart, bigbasket, dmart, flipkart, jiomart };

export function activeAdapters(filter) {
  const wanted = filter?.length ? filter : config.platforms;
  return wanted.map((id) => ALL_ADAPTERS[id]).filter(Boolean);
}

/**
 * Run one platform's search with a timeout and full error capture.
 * A platform being down or blocked must never take the whole search with it —
 * partial results beat an error page every time.
 */
async function runOne(adapter, query) {
  const started = Date.now();
  try {
    const offers = await Promise.race([
      adapter.search(query),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
    ]);
    const ms = Date.now() - started;
    offers.forEach((o) => recordOffer(o));
    logScrape(adapter.id, query, true, offers.length, ms, null);
    return { platform: adapter.id, ok: true, ms, offers };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err?.message || String(err);
    logScrape(adapter.id, query, false, 0, ms, msg);
    return { platform: adapter.id, ok: false, ms, offers: [], error: msg, blocked: !!err?.blocked };
  }
}

/**
 * Search every enabled platform. Sequential by design: a shared browser plus
 * four simultaneous heavy SPA loads is how you get throttled. The small
 * stagger is deliberate politeness, not a bug.
 */
export async function searchAll(query, { platforms } = {}) {
  const adapters = activeAdapters(platforms);
  const results = [];
  for (const a of adapters) {
    results.push(await runOne(a, query));
    if (a !== adapters[adapters.length - 1]) await sleep(config.scrapeDelayMs);
  }
  return results;
}
