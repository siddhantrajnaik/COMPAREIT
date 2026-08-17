/**
 * Static-mode API.
 *
 * On GitHub Pages there is no backend, so this reads the JSON the scheduled
 * scraper committed and answers the same method signatures the live API does.
 * The UI stays identical; only the data source changes.
 *
 * What genuinely cannot work without a server is marked `unsupported` rather
 * than faked — an on-demand search needs a browser driving real pages, and
 * quietly returning stale results while pretending they're live would be worse
 * than saying so.
 */

const BASE = import.meta.env.BASE_URL || '/';
let cache = null;

async function load() {
  if (cache) return cache;
  const [snapshot, alerts] = await Promise.all([
    fetch(`${BASE}data/snapshot.json`, { cache: 'no-cache' }).then((r) => r.json()),
    fetch(`${BASE}data/alerts.json`, { cache: 'no-cache' }).then((r) => r.json()).catch(() => []),
  ]);
  cache = { snapshot, alerts };
  return cache;
}

class Unsupported extends Error {
  constructor(what) {
    super(`${what} needs the local app — this is the scheduled snapshot. Run it on your machine for live search.`);
    this.unsupported = true;
  }
}

const norm = (s) => String(s || '').toLowerCase().trim();

export const staticApi = {
  isStatic: true,

  async health() {
    const { snapshot } = await load();
    return {
      ok: true,
      static: true,
      degraded: !!snapshot.degraded,
      degradedReason: snapshot.degradedReason || null,
      generatedAt: snapshot.generatedAt,
      location: snapshot.location,
      platforms: snapshot.platforms.map((p) => p.platform),
      platformMeta: Object.fromEntries(snapshot.platforms.map((p) => [p.platform, p.meta])),
      push: false,
      vapidPublicKey: null,
      poller: { lastRun: snapshot.generatedAt, intervalMs: null },
      rescue: { enabled: false, status: 'unavailable' },
    };
  },

  async cities() { return []; },
  async setLocation() { throw new Unsupported('Changing location'); },

  /**
   * Matches the query against the tracked items rather than scraping. An exact
   * or prefix match wins; otherwise we fall back to token overlap so a partial
   * memory of what you tracked still finds it.
   */
  async search(q) {
    const { snapshot } = await load();
    const query = norm(q);
    const scored = snapshot.items.map((it) => {
      const hay = `${norm(it.query)} ${norm(it.label)}`;
      let score = 0;
      if (hay.includes(query)) score = 100;
      else {
        const qt = query.split(/\s+/).filter(Boolean);
        score = qt.filter((t) => hay.includes(t)).length / Math.max(1, qt.length) * 80;
      }
      return { it, score };
    }).filter((x) => x.score > 20).sort((a, b) => b.score - a.score);

    return {
      query: q,
      groups: scored.flatMap((x) => x.it.groups),
      platforms: snapshot.platforms.map((p) => ({ ...p, ms: 0 })),
      ts: snapshot.generatedAt,
      cached: true,
      cachedAt: snapshot.generatedAt,
      staticNotice: scored.length
        ? null
        : 'Only tracked items are available here. Edit watchlist.json to add more.',
    };
  },

  async watches() {
    const { snapshot } = await load();
    return snapshot.items.map((it, i) => {
      const offers = it.groups.flatMap((g) => g.offers).filter((o) => o.inStock);
      const sorted = [...offers].sort((a, b) => a.price - b.price);
      return {
        id: i + 1,
        query: it.query,
        label: it.label,
        target_price: null,
        min_discount: null,
        last_checked: snapshot.generatedAt,
        best: sorted[0]
          ? { id: sorted[0].id, name: sorted[0].name, platform: sorted[0].platform,
              price: sorted[0].price, mrp: sorted[0].mrp, in_stock: 1 }
          : null,
        current: sorted.slice(0, 6).map((o) => ({
          id: o.id, platform: o.platform, price: o.price, mrp: o.mrp, in_stock: 1,
        })),
      };
    });
  },

  async addWatch() { throw new Unsupported('Adding a watch'); },
  async updateWatch() { throw new Unsupported('Editing a watch'); },
  async delWatch() { throw new Unsupported('Removing a watch'); },
  async checkWatch() { throw new Unsupported('Manual re-check'); },

  async history(productId) {
    const { snapshot } = await load();
    for (const it of snapshot.items) {
      for (const g of it.groups) {
        const o = g.offers.find((x) => x.id === productId);
        if (o?.history) {
          return {
            productId,
            points: o.history.map(([t, p, s]) => ({ t, p, s: !!s })),
            median: o.deal?.median ?? null,
          };
        }
      }
    }
    return { productId, points: [], median: null };
  },

  async deals() {
    const { snapshot } = await load();
    return snapshot.deals.map((d) => ({
      ...d,
      name: d.name, price: d.price, mrp: d.mrp, ts: snapshot.generatedAt,
      unit_text: d.unitText,
      vsMrp: d.deal.vsMrp, vsMedian: d.deal.vsMedian,
      median: d.deal.median, score: d.deal.score, hasHistory: d.deal.hasHistory,
    }));
  },

  async alerts() {
    const { alerts } = await load();
    return alerts.map((a, i) => ({
      id: i + 1, kind: a.kind, title: a.title, body: a.body,
      ts: a.ts, seen: 1, payload: { platform: a.platform, price: a.price },
    }));
  },
  async markSeen() { return { ok: true }; },
  async clearAlerts() { throw new Unsupported('Clearing alerts'); },

  async lists() { return []; },
  async basket() { return []; },
  async addBasket() { throw new Unsupported('The basket'); },
  async updateBasket() { throw new Unsupported('The basket'); },
  async delBasket() { throw new Unsupported('The basket'); },
  async optimise() { throw new Unsupported('Basket optimisation'); },

  async fees() {
    const { snapshot } = await load();
    return Object.fromEntries(snapshot.platforms.map((p) => [p.platform, p.meta]));
  },
  async saveFees() { throw new Unsupported('Editing fees'); },
  async resetFees() { throw new Unsupported('Editing fees'); },

  async subscribe() { throw new Unsupported('Server-side push registration'); },
  async unsubscribe() { return { ok: true }; },
  async testPush() { throw new Unsupported('Test notifications'); },

  async rescueStatus() { return { enabled: false, status: 'unavailable' }; },
  async rescueCheck() { throw new Unsupported('Food Rescue'); },
  async rescueToggle() { throw new Unsupported('Food Rescue'); },

  async poller() {
    const { snapshot } = await load();
    return { lastRun: snapshot.generatedAt, intervalMs: null, running: false };
  },
  async pollRun() { throw new Unsupported('Running a sweep'); },
  async pollToggle() { throw new Unsupported('The poller'); },

  async diagnostics() {
    const { snapshot } = await load();
    return {
      byPlatform: Object.fromEntries(snapshot.platforms.map((p) => [
        p.platform,
        { ok: p.ok ? 1 : 0, fail: p.ok ? 0 : 1, avgMs: 0, n: 1, lastError: p.error },
      ])),
      recent: [],
      counts: {
        products: snapshot.items.reduce((n, it) => n + it.groups.reduce((m, g) => m + g.offers.length, 0), 0),
        pricePoints: 0,
        watches: snapshot.items.length,
        alerts: (await load()).alerts.length,
        pushSubs: 0,
      },
    };
  },
};
