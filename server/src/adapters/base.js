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
export const PLATFORM_META = {
  blinkit:   { label: 'Blinkit',   color: '#F8CB46', textColor: '#1a1a1a', deliveryFee: 25, freeAbove: 199, handling: 9 },
  zepto:     { label: 'Zepto',     color: '#3F1D6B', textColor: '#ffffff', deliveryFee: 25, freeAbove: 199, handling: 9 },
  instamart: { label: 'Instamart', color: '#F97316', textColor: '#ffffff', deliveryFee: 25, freeAbove: 199, handling: 10 },
  bigbasket: { label: 'BigBasket', color: '#84C225', textColor: '#1a1a1a', deliveryFee: 30, freeAbove: 400, handling: 0 },
  // Slot-based / marketplace rather than 10-minute delivery — different fee
  // shape, which is exactly why the optimiser costs whole baskets and not items.
  dmart:     { label: 'DMart',     color: '#00A0E3', textColor: '#ffffff', deliveryFee: 49, freeAbove: 999, handling: 0 },
  flipkart:  { label: 'Flipkart',  color: '#2874F0', textColor: '#ffffff', deliveryFee: 40, freeAbove: 500, handling: 0 },
  jiomart:   { label: 'JioMart',   color: '#0C831F', textColor: '#ffffff', deliveryFee: 40, freeAbove: 999, handling: 0 },
};
