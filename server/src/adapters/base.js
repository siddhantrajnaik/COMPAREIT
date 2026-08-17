import { parseUnit, buildMatchKey, pricePerUnit } from '../normalize.js';

/**
 * Every adapter returns raw-ish rows; this turns them into the one canonical
 * shape the rest of the app speaks. Doing it in exactly one place means a new
 * platform only has to answer "where are the fields", never "what shape".
 */
export function toOffer(platform, raw) {
  if (!raw || !raw.name) return null;

  const price = num(raw.price);
  if (price == null || price <= 0) return null;

  let mrp = num(raw.mrp);
  // Platforms set mrp === price when there's no offer running, and occasionally
  // report an mrp below price. Neither is a real MRP, and rendering one would
  // put a struck-through number identical to the price right next to it.
  if (mrp != null && mrp <= price) mrp = null;

  const parsed = parseUnit(raw.unitText || raw.name);
  const nativeId = String(raw.nativeId ?? raw.id ?? raw.name);
  const discount = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

  return {
    id: `${platform}:${nativeId}`,
    platform,
    nativeId,
    name: String(raw.name).trim(),
    brand: raw.brand ? String(raw.brand).trim() : null,
    unitText: raw.unitText ? String(raw.unitText).trim() : null,
    qty: parsed?.qty ?? null,
    unit: parsed?.unit ?? null,
    image: raw.image || null,
    url: raw.url || null,
    category: raw.category || null,
    price,
    mrp,
    discount,
    inStock: raw.inStock !== false,
    eta: raw.eta || null,
    ppu: pricePerUnit(price, parsed?.qty, parsed?.unit),
    matchKey: buildMatchKey(raw.name, raw.brand, parsed),
  };
}

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export { num };

/**
 * Platform metadata used by the basket optimiser. Fee structures change often
 * and differ by city and cart value; these are sane defaults you can edit in
 * the app's Settings rather than hard truths.
 */
/**
 * `kind` is not cosmetic — it stops the app comparing unlike things.
 *
 *   quick       10-minute dark-store delivery
 *   slotted     same/next-day grocery, delivered in a chosen slot
 *   marketplace third-party sellers, delivery in days, bulk packs common
 *
 * A ₹63 butter arriving in 8 minutes and a ₹63 butter arriving Thursday from a
 * reseller are not the same offer, and showing them in one column with only a
 * price to separate them invites the wrong conclusion. The UI labels anything
 * that isn't `quick` so the trade-off is visible.
 *
 * Note on Flipkart: this is the general marketplace, NOT Flipkart Minutes.
 * Minutes sits behind an interactive pincode/login gate that never initialises
 * under automation, so it cannot be scraped — see README.
 */
export const PLATFORM_META = {
  blinkit:   { label: 'Blinkit',   kind: 'quick',       color: '#F8CB46', textColor: '#1a1a1a', deliveryFee: 25, freeAbove: 199, handling: 9 },
  zepto:     { label: 'Zepto',     kind: 'quick',       color: '#3F1D6B', textColor: '#ffffff', deliveryFee: 25, freeAbove: 199, handling: 9 },
  instamart: { label: 'Instamart', kind: 'quick',       color: '#F97316', textColor: '#ffffff', deliveryFee: 25, freeAbove: 199, handling: 10 },
  bigbasket: { label: 'BigBasket', kind: 'slotted',     color: '#84C225', textColor: '#1a1a1a', deliveryFee: 30, freeAbove: 400, handling: 0 },
  dmart:     { label: 'DMart',     kind: 'slotted',     color: '#00A0E3', textColor: '#ffffff', deliveryFee: 49, freeAbove: 999, handling: 0 },
  jiomart:   { label: 'JioMart',   kind: 'slotted',     color: '#0C831F', textColor: '#ffffff', deliveryFee: 40, freeAbove: 999, handling: 0 },
  flipkart:  { label: 'Flipkart',  kind: 'marketplace', color: '#2874F0', textColor: '#ffffff', deliveryFee: 40, freeAbove: 500, handling: 0 },

  // Reachable only via captured mobile-API configs (see docs/CAPTURE.md).
  // Present here so that the moment a capture is dropped in, the UI already
  // knows the brand colour, delivery class and fee shape.
  'flipkart-minutes': { label: 'Flipkart Minutes', kind: 'quick', color: '#FFD400', textColor: '#1a1a1a', deliveryFee: 25, freeAbove: 199, handling: 9 },
  'amazon-now':       { label: 'Amazon Now',       kind: 'quick', color: '#FF9900', textColor: '#1a1a1a', deliveryFee: 25, freeAbove: 199, handling: 9 },
};

/** Short, honest description of how long an order actually takes to arrive. */
export const KIND_NOTE = {
  quick: null,                       // the baseline — no note needed
  slotted: 'delivery slot',
  marketplace: 'ships in days',
};
