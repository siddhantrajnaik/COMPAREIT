import { PLATFORM_META } from '../adapters/base.js';

/**
 * Basket optimiser.
 *
 * "Which app is cheapest" is the wrong question once delivery and handling fees
 * exist: Blinkit can win on every single item and still lose the basket because
 * you didn't clear its free-delivery threshold. So we cost the whole basket per
 * platform including fees, then also compute the split-cart option — buy each
 * item wherever it's cheapest, pay every platform's fees — and report both.
 */
export function optimiseBasket(lines, opts = {}) {
  // Merge per platform, not wholesale — a partial override (say, delivery fee
  // only) must not wipe out the other fee fields for that platform.
  const fees = { ...PLATFORM_META };
  for (const [p, v] of Object.entries(opts.feeOverrides || {})) {
    fees[p] = { ...(PLATFORM_META[p] || {}), ...v };
  }
  const platforms = [...new Set(lines.flatMap((l) => l.groups.flatMap((g) => g.offers.map((o) => o.platform))))];

  const singleCart = platforms.map((p) => {
    const items = [];
    let subtotal = 0;
    let missing = 0;

    for (const line of lines) {
      // Cheapest in-stock offer for this line on this platform.
      let best = null;
      for (const g of line.groups) {
        for (const o of g.offers) {
          if (o.platform !== p || !o.inStock) continue;
          if (!best || o.price < best.price) best = { ...o, groupName: g.name };
        }
      }
      if (!best) { missing++; items.push({ query: line.query, qty: line.qty, missing: true }); continue; }
      const cost = best.price * line.qty;
      subtotal += cost;
      items.push({ query: line.query, qty: line.qty, offer: best, cost: round(cost) });
    }

    const meta = fees[p] || {};
    const delivery = subtotal >= (meta.freeAbove ?? Infinity) ? 0 : (meta.deliveryFee ?? 0);
    const handling = subtotal > 0 ? (meta.handling ?? 0) : 0;

    return {
      platform: p,
      meta: PLATFORM_META[p] || { label: p, color: '#888', textColor: '#fff' },
      items, subtotal: round(subtotal),
      delivery, handling,
      total: round(subtotal + delivery + handling),
      missing,
      complete: missing === 0,
    };
  }).sort((a, b) => {
    // A cart missing items isn't really a contender, however cheap.
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return a.total - b.total;
  });

  // Split cart: cheapest source per line, fees charged once per platform used.
  const splitItems = [];
  const usedSubtotals = {};
  for (const line of lines) {
    let best = null;
    for (const g of line.groups) {
      for (const o of g.offers) {
        if (!o.inStock) continue;
        if (!best || o.price < best.price) best = { ...o, groupName: g.name };
      }
    }
    if (!best) { splitItems.push({ query: line.query, qty: line.qty, missing: true }); continue; }
    const cost = best.price * line.qty;
    usedSubtotals[best.platform] = (usedSubtotals[best.platform] || 0) + cost;
    splitItems.push({ query: line.query, qty: line.qty, offer: best, cost: round(cost) });
  }

  let splitSubtotal = 0, splitFees = 0;
  for (const [p, sub] of Object.entries(usedSubtotals)) {
    const meta = fees[p] || {};
    splitSubtotal += sub;
    splitFees += (sub >= (meta.freeAbove ?? Infinity) ? 0 : (meta.deliveryFee ?? 0)) + (meta.handling ?? 0);
  }

  const split = {
    items: splitItems,
    platforms: Object.keys(usedSubtotals),
    subtotal: round(splitSubtotal),
    fees: round(splitFees),
    total: round(splitSubtotal + splitFees),
    missing: splitItems.filter((i) => i.missing).length,
  };

  const bestSingle = singleCart.find((c) => c.complete) || singleCart[0] || null;
  const recommendation =
    bestSingle && split.missing === 0 && split.total < bestSingle.total - 1
      ? { mode: 'split', saves: round(bestSingle.total - split.total) }
      : { mode: 'single', platform: bestSingle?.platform ?? null };

  return { singleCart, split, recommendation };
}

const round = (n) => Math.round(n * 100) / 100;
