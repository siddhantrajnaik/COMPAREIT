import { similarity } from './normalize.js';
import { PLATFORM_META } from './adapters/base.js';

/**
 * Group offers from different platforms into "this is the same thing" clusters.
 *
 * Greedy agglomeration: walk offers best-first, and attach each to the existing
 * group whose representative it most resembles, provided the score clears a
 * threshold AND the group doesn't already hold that platform. That last rule
 * matters — two different Amul butters on Blinkit must not collapse into one
 * row, or the "cheapest" number becomes a lie.
 */
const THRESHOLD = 0.62;

export function groupOffers(resultSets) {
  const offers = [];
  for (const r of resultSets) for (const o of r.offers) offers.push(o);

  // Exact match-key collisions are free wins; do those first.
  const byKey = new Map();
  for (const o of offers) {
    if (!byKey.has(o.matchKey)) byKey.set(o.matchKey, []);
    byKey.get(o.matchKey).push(o);
  }

  const groups = [];
  const place = (offer) => {
    let best = null, bestScore = 0;
    for (const g of groups) {
      if (g.offers.some((x) => x.platform === offer.platform)) continue;
      const s = similarity(g.rep, offer);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    if (best && bestScore >= THRESHOLD) {
      best.offers.push(offer);
      // Keep the longest name as representative — usually the most descriptive.
      if (offer.name.length > best.rep.name.length) best.rep = offer;
    } else {
      groups.push({ rep: offer, offers: [offer] });
    }
  };

  // Seed with same-key clusters, then place the rest.
  const seeded = new Set();
  for (const [, list] of byKey) {
    if (list.length < 2) continue;
    const byPlatform = new Map();
    for (const o of list) if (!byPlatform.has(o.platform)) byPlatform.set(o.platform, o);
    if (byPlatform.size < 2) continue;
    const members = [...byPlatform.values()];
    groups.push({ rep: members.reduce((a, b) => (b.name.length > a.name.length ? b : a)), offers: members });
    members.forEach((m) => seeded.add(m.id));
  }
  for (const o of offers) if (!seeded.has(o.id)) place(o);

  return groups.map(finalizeGroup)
    .sort((a, b) => {
      // Multi-platform comparisons are the point of the app — float them up.
      if (b.offers.length !== a.offers.length) return b.offers.length - a.offers.length;
      return (b.maxSaving || 0) - (a.maxSaving || 0);
    });
}

function finalizeGroup(g) {
  const inStock = g.offers.filter((o) => o.inStock);
  const pool = inStock.length ? inStock : g.offers;

  const cheapest = pool.reduce((a, b) => (b.price < a.price ? b : a));
  const dearest = pool.reduce((a, b) => (b.price > a.price ? b : a));

  // Price-per-unit is the honest comparison when pack sizes differ.
  const withPpu = pool.filter((o) => o.ppu);
  const bestPpu = withPpu.length
    ? withPpu.reduce((a, b) => (b.ppu.value < a.ppu.value ? b : a))
    : null;

  const offers = [...g.offers].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    return a.price - b.price;
  }).map((o) => ({
    ...o,
    meta: PLATFORM_META[o.platform] || { label: o.platform, color: '#888', textColor: '#fff' },
    isCheapest: o.id === cheapest.id,
    isBestPpu: bestPpu ? o.id === bestPpu.id : false,
  }));

  return {
    key: g.rep.matchKey + '|' + g.rep.id,
    name: g.rep.name,
    brand: g.rep.brand,
    image: g.offers.find((o) => o.image)?.image || null,
    unitText: g.rep.unitText,
    qty: g.rep.qty,
    unit: g.rep.unit,
    offers,
    cheapestPrice: cheapest.price,
    cheapestPlatform: cheapest.platform,
    bestPpu: bestPpu ? { ...bestPpu.ppu, platform: bestPpu.platform } : null,
    // What you'd waste by buying this on the priciest platform instead.
    maxSaving: Math.round((dearest.price - cheapest.price) * 100) / 100,
    maxSavingPct: dearest.price > 0
      ? Math.round(((dearest.price - cheapest.price) / dearest.price) * 100) : 0,
    bestDiscount: Math.max(...g.offers.map((o) => o.discount || 0)),
    platformCount: new Set(g.offers.map((o) => o.platform)).size,
  };
}
