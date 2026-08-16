#!/usr/bin/env node
/**
 * Scheduled scraper for the serverless (GitHub Actions + Pages) deployment.
 *
 * There is no server in that mode, so this script does everything the backend
 * would normally do on a timer — scrape, group, score, diff against history —
 * and writes plain JSON that the static site reads. History lives in the repo
 * as a committed file, which is what makes trailing-median deal detection
 * possible without a database.
 *
 *   node server/scripts/scrape-static.js
 *
 * Writes:
 *   web/public/data/snapshot.json   current prices, grouped and scored
 *   web/public/data/history.json    append-only price series per product
 *   web/public/data/alerts.json     rolling alert log
 *   .push-queue.json                alerts that fired this run (for web-push)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config, saveLocation } from '../src/config.js';
import { setLocationCookies, closeBrowser } from '../src/browser.js';
import { searchAll } from '../src/adapters/index.js';
import { groupOffers } from '../src/match.js';
import { relevance, pricePerUnit } from '../src/normalize.js';
import { PLATFORM_META } from '../src/adapters/base.js';

const DATA_DIR = path.join(ROOT, 'web', 'public', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 0) + '\n');

const wl = readJson(path.join(ROOT, 'watchlist.json'), null);
if (!wl?.items?.length) {
  console.error('watchlist.json is missing or has no items');
  process.exit(1);
}

// Location comes from the watchlist so it lives in version control with
// everything else — no server settings screen exists in this mode.
if (wl.location) {
  saveLocation({
    lat: Number(wl.location.lat), lon: Number(wl.location.lon),
    locality: wl.location.locality, pincode: wl.location.pincode,
  });
}
const platforms = wl.platforms?.length ? wl.platforms : config.platforms;

const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');

const history = readJson(HISTORY_PATH, {});   // { productId: [[ts, price, inStock], ...] }
const alerts = readJson(ALERTS_PATH, []);

const HISTORY_DAYS = 90;
const MAX_POINTS = 240;                        // keeps the committed file small
const now = Date.now();
const cutoff = now - HISTORY_DAYS * 864e5;

/** Median of a product's recent prices — the baseline a real deal must beat. */
function median(series) {
  const vals = series.map((p) => p[1]).sort((a, b) => a - b);
  if (!vals.length) return null;
  return vals[Math.floor(vals.length / 2)];
}

const firedAlerts = [];

function pushAlert(a) {
  const rec = { ...a, ts: now, id: `${a.kind}:${a.productId}:${now}` };
  alerts.unshift(rec);
  firedAlerts.push(rec);
}

console.log(`Scraping ${wl.items.length} items across ${platforms.join(', ')}`);
await setLocationCookies();

const items = [];
const platformStats = new Map();

for (const [i, item] of wl.items.entries()) {
  const q = item.query;
  process.stdout.write(`  [${i + 1}/${wl.items.length}] ${q} … `);

  let results;
  try {
    results = await searchAll(q, { platforms });
  } catch (err) {
    console.log(`FAILED (${err.message.slice(0, 50)})`);
    items.push({ query: q, label: item.label || q, groups: [], error: err.message });
    continue;
  }

  for (const r of results) {
    const s = platformStats.get(r.platform) || { ok: 0, fail: 0, offers: 0, blocked: false, error: null };
    if (r.ok) { s.ok++; s.offers += r.offers.length; }
    else { s.fail++; s.blocked = s.blocked || !!r.blocked; s.error = r.error; }
    platformStats.set(r.platform, s);
  }

  // Same ranking the live API uses, so both deployments agree on "best".
  const groups = groupOffers(results)
    .map((g) => ({ ...g, relevance: Math.max(...g.offers.map((o) => relevance(q, o.name, o.brand))) }))
    .filter((g) => g.relevance > 0)
    .sort((a, b) => {
      const rel = Math.round(b.relevance * 4) - Math.round(a.relevance * 4);
      if (rel) return rel;
      if (b.platformCount !== a.platformCount) return b.platformCount - a.platformCount;
      return (b.maxSaving || 0) - (a.maxSaving || 0);
    })
    .slice(0, 3);   // top candidates only — keeps the committed JSON small

  // Record history and evaluate each offer against its own past.
  for (const g of groups) {
    for (const o of g.offers) {
      const series = (history[o.id] || []).filter((p) => p[0] > cutoff);
      const prev = series[series.length - 1] || null;
      const med = median(series);
      const observations = series.length;

      const changed = !prev || prev[1] !== o.price || !!prev[2] !== !!o.inStock;
      if (changed) series.push([now, o.price, o.inStock ? 1 : 0]);
      history[o.id] = series.slice(-MAX_POINTS);

      const vsMrp = o.mrp && o.mrp > o.price ? Math.round(((o.mrp - o.price) / o.mrp) * 100) : 0;
      const vsMedian = med && med > o.price ? Math.round(((med - o.price) / med) * 100) : 0;
      const hasHistory = observations >= 3;
      const score = hasHistory
        ? Math.min(100, Math.round(vsMedian * 2.2 + vsMrp * 0.8))
        : Math.min(100, Math.round(vsMrp * 1.2));

      o.deal = { score, vsMrp, vsMedian, median: med, hasHistory, observations };
      o.history = series.slice(-60);

      // Alerts: only on a transition, never repeatedly while a condition holds.
      if (prev && o.inStock) {
        const dropPct = Math.round(((prev[1] - o.price) / prev[1]) * 100);
        if (dropPct >= 8) {
          pushAlert({
            kind: 'drop', productId: o.id, platform: o.platform,
            title: `${o.name} — ₹${o.price}`,
            body: `Down ${dropPct}% from ₹${prev[1]} on ${o.meta?.label || o.platform}.`,
            price: o.price, url: o.url,
          });
        }
        if (!prev[2] && o.inStock) {
          pushAlert({
            kind: 'restock', productId: o.id, platform: o.platform,
            title: `Back in stock: ${o.name}`,
            body: `Available again on ${o.meta?.label || o.platform} at ₹${o.price}.`,
            price: o.price, url: o.url,
          });
        }
      }
      if (hasHistory && score >= 55 && o.inStock) {
        const recent = alerts.find((a) => a.productId === o.id && a.kind === 'deal' && now - a.ts < 12 * 3600e3);
        if (!recent) {
          pushAlert({
            kind: 'deal', productId: o.id, platform: o.platform,
            title: `${o.name} — ₹${o.price}`,
            body: `${vsMedian}% below its usual ₹${med} on ${o.meta?.label || o.platform}.`,
            price: o.price, url: o.url,
          });
        }
      }
    }
  }

  const best = groups[0]?.offers?.find((o) => o.inStock);
  console.log(groups.length ? `${groups.length} groups, best ₹${best?.price ?? '—'}` : 'no matches');
  items.push({ query: q, label: item.label || q, groups });
}

await closeBrowser();

// Cross-item deal board, ranked the same way the live app ranks it.
const deals = items
  .flatMap((it) => it.groups.flatMap((g) => g.offers.map((o) => ({ ...o, forItem: it.label }))))
  .filter((o) => o.inStock && o.deal && o.deal.score >= 20)
  .sort((a, b) => {
    if (a.deal.hasHistory !== b.deal.hasHistory) return a.deal.hasHistory ? -1 : 1;
    return b.deal.score - a.deal.score;
  })
  .slice(0, 30)
  .map((o) => ({ ...o, ppu: o.ppu || pricePerUnit(o.price, o.qty, o.unit) }));

const snapshot = {
  generatedAt: now,
  location: config.location,
  platforms: [...platformStats.entries()].map(([platform, s]) => ({
    platform, meta: PLATFORM_META[platform],
    ok: s.ok > 0, count: s.offers, blocked: s.blocked && s.ok === 0,
    error: s.ok === 0 ? s.error : null,
  })),
  items,
  deals,
};

// Trim history of anything we no longer track, so the file can't grow forever.
const live = new Set(items.flatMap((it) => it.groups.flatMap((g) => g.offers.map((o) => o.id))));
for (const id of Object.keys(history)) {
  history[id] = history[id].filter((p) => p[0] > cutoff);
  if (!history[id].length || (!live.has(id) && history[id].at(-1)[0] < now - 14 * 864e5)) delete history[id];
}

writeJson(path.join(DATA_DIR, 'snapshot.json'), snapshot);
writeJson(HISTORY_PATH, history);
writeJson(ALERTS_PATH, alerts.slice(0, 100));
writeJson(path.join(ROOT, '.push-queue.json'), firedAlerts);

const okPlatforms = snapshot.platforms.filter((p) => p.ok).map((p) => p.platform);
console.log(`\nDone. ${items.length} items · ${deals.length} deals · ${firedAlerts.length} new alerts`);
console.log(`Platforms returning data: ${okPlatforms.join(', ') || 'none'}`);
console.log(`History tracks ${Object.keys(history).length} products`);
process.exit(0);
