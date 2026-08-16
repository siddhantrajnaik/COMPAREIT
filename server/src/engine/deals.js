import { trailingMedian, priceHistory } from '../db.js';

/**
 * Deal scoring.
 *
 * The whole point is to distinguish a real drop from marketing theatre. An
 * inflated MRP with a permanent "60% OFF" badge is not a deal. So a discount
 * only counts as notable when the price is also low against its OWN recent
 * history. That's what the trailing median is for.
 */

export function evaluateOffer(offer, prev) {
  const signals = [];
  const median = trailingMedian(offer.id, 30);

  const vsMrp = offer.mrp && offer.mrp > offer.price
    ? Math.round(((offer.mrp - offer.price) / offer.mrp) * 100) : 0;

  const vsMedian = median && median > offer.price
    ? Math.round(((median - offer.price) / median) * 100) : 0;

  if (vsMrp >= 25) signals.push({ kind: 'mrp', pct: vsMrp, text: `${vsMrp}% below MRP` });
  if (vsMedian >= 10) signals.push({ kind: 'median', pct: vsMedian, text: `${vsMedian}% below its 30-day usual` });

  if (prev && prev.price > offer.price) {
    const drop = Math.round(((prev.price - offer.price) / prev.price) * 100);
    if (drop >= 5) signals.push({ kind: 'drop', pct: drop, text: `dropped ${drop}% since last check` });
  }

  if (prev && !prev.in_stock && offer.inStock) {
    signals.push({ kind: 'restock', pct: 0, text: 'back in stock' });
  }

  // A composite 0-100 "how excited should you be" score. Weighted toward
  // history, because that's the part platforms can't manufacture.
  const score = Math.min(100, Math.round(vsMedian * 2.2 + vsMrp * 0.8));

  return { score, signals, vsMrp, vsMedian, median, isDeal: score >= 30 };
}

/** Does this offer satisfy an explicit watch rule the user set? */
export function checkWatchRules(watch, offer, prev) {
  const hits = [];

  if (watch.target_price != null && offer.price <= watch.target_price && offer.inStock) {
    // Only fire when we cross the line, not on every poll while below it.
    if (!prev || prev.price > watch.target_price) {
      hits.push({
        kind: 'target',
        title: `₹${offer.price} — hit your target`,
        body: `${offer.name} is ₹${offer.price} on ${offer.platform} (target ₹${watch.target_price}).`,
      });
    }
  }

  if (watch.min_discount != null && offer.discount >= watch.min_discount && offer.inStock) {
    if (!prev || prevDiscount(prev) < watch.min_discount) {
      hits.push({
        kind: 'discount',
        title: `${offer.discount}% off ${offer.name}`,
        body: `Now ₹${offer.price}${offer.mrp ? ` (MRP ₹${offer.mrp})` : ''} on ${offer.platform}.`,
      });
    }
  }

  if (watch.notify_restock && prev && !prev.in_stock && offer.inStock) {
    hits.push({
      kind: 'restock',
      title: `Back in stock: ${offer.name}`,
      body: `Available again on ${offer.platform} at ₹${offer.price}.`,
    });
  }

  return hits;
}

function prevDiscount(prev) {
  if (!prev?.mrp || prev.mrp <= prev.price) return 0;
  return Math.round(((prev.mrp - prev.price) / prev.mrp) * 100);
}

export function sparkline(productId, days = 30) {
  const rows = priceHistory(productId, days);
  return rows.map((r) => ({ t: r.ts, p: r.price, s: !!r.in_stock }));
}
