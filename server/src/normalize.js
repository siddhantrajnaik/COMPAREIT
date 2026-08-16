/**
 * Unit normalisation.
 *
 * Quick-commerce platforms describe the same physical item a dozen different
 * ways: "1 ltr", "1 L", "1000 ml", "2 x 500 ml", "Pack of 6 x 100 g", "6 pcs".
 * Comparing sticker prices across those is meaningless — ₹72 for 1 L beats ₹40
 * for 500 ml. Everything here exists to turn a messy string into
 * (magnitude, base-unit) so we can compute a true price-per-unit.
 */

const UNIT_ALIASES = [
  // [regex, canonical base unit, multiplier to base]
  [/^(kgs?|kilogram(s)?)$/i, 'g', 1000],
  [/^(gm?s?|gram(s)?|grm)$/i, 'g', 1],
  [/^(mg)$/i, 'g', 0.001],
  [/^(l|lt|ltr|ltrs|liter(s)?|litre(s)?)$/i, 'ml', 1000],
  [/^(ml|mls|millilitre(s)?|milliliter(s)?)$/i, 'ml', 1],
  [/^(pc|pcs|piece(s)?|unit(s)?|nos?|count|ct|pack(s)?|sachet(s)?|tablet(s)?|capsule(s)?|egg(s)?|bunch(es)?|combo)$/i, 'pcs', 1],
  [/^(dozen)$/i, 'pcs', 12],
];

function resolveUnit(raw) {
  if (!raw) return null;
  const t = String(raw).trim().replace(/\.$/, '');
  for (const [re, base, mult] of UNIT_ALIASES) {
    if (re.test(t)) return { base, mult };
  }
  return null;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '([a-zA-Z]+)';

/**
 * Parse a pack-size string into { qty, unit, packs }.
 * Returns null when there's nothing numeric to work with.
 *
 *   "500 g"            -> { qty: 500,  unit: 'g',   packs: 1 }
 *   "1 ltr"            -> { qty: 1000, unit: 'ml',  packs: 1 }
 *   "2 x 200 ml"       -> { qty: 400,  unit: 'ml',  packs: 2 }
 *   "Pack of 6"        -> { qty: 6,    unit: 'pcs', packs: 6 }
 *   "6 x 100 g Combo"  -> { qty: 600,  unit: 'g',   packs: 6 }
 */
export function parseUnit(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

  // "2 x 200 ml" / "2*200ml" / "6 X 100 g"
  let m = s.match(new RegExp(`${NUM}\\s*[x*×]\\s*${NUM}\\s*${UNIT}`));
  if (m) {
    const packs = parseFloat(m[1].replace(',', '.'));
    const each = parseFloat(m[2].replace(',', '.'));
    const u = resolveUnit(m[3]);
    if (u && packs > 0 && each > 0) {
      return { qty: round(packs * each * u.mult), unit: u.base, packs };
    }
  }

  // Zepto's format: "1 pack (100 g)", "2 pack (500 ml)", "3 packs (75 g)".
  // Must run before the generic scan below, which would otherwise take only the
  // inner size and silently price a 2-pack as if it were a single unit.
  m = s.match(new RegExp(`${NUM}\\s*packs?\\s*\\(?\\s*${NUM}\\s*${UNIT}`));
  if (m) {
    const packs = parseFloat(m[1].replace(',', '.'));
    const each = parseFloat(m[2].replace(',', '.'));
    const u = resolveUnit(m[3]);
    if (u && packs > 0 && each > 0) {
      return { qty: round(packs * each * u.mult), unit: u.base, packs };
    }
  }

  // "pack of 6" / "combo of 4"
  m = s.match(/(?:pack|combo|set|box)\s*of\s*(\d+)/);
  if (m) {
    const packs = parseInt(m[1], 10);
    // If a per-unit size follows ("pack of 6 x 100 g" handled above), fall back to pieces.
    const inner = s.match(new RegExp(`${NUM}\\s*${UNIT}`));
    if (inner) {
      const u = resolveUnit(inner[2]);
      const val = parseFloat(inner[1].replace(',', '.'));
      if (u && u.base !== 'pcs' && val > 0) {
        return { qty: round(packs * val * u.mult), unit: u.base, packs };
      }
    }
    if (packs > 0) return { qty: packs, unit: 'pcs', packs };
  }

  // Plain "500 g" / "1ltr" / "250ml" — take the LAST match so brand names
  // containing numbers ("Nestle a+ 100") don't win over the real size.
  const all = [...s.matchAll(new RegExp(`${NUM}\\s*${UNIT}`, 'g'))];
  for (let i = all.length - 1; i >= 0; i--) {
    const u = resolveUnit(all[i][2]);
    const val = parseFloat(all[i][1].replace(',', '.'));
    if (u && val > 0) return { qty: round(val * u.mult), unit: u.base, packs: 1 };
  }

  // Bare number, no unit: "6" -> 6 pieces
  m = s.match(/^\s*(\d+)\s*$/);
  if (m) return { qty: parseInt(m[1], 10), unit: 'pcs', packs: parseInt(m[1], 10) };

  return null;
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Display basis: per 100 g, per litre, per piece. */
export const BASIS = { g: { per: 100, label: '100g' }, ml: { per: 1000, label: 'L' }, pcs: { per: 1, label: 'pc' } };

/** Price per comparable unit. Returns null when size is unknown. */
export function pricePerUnit(price, qty, unit) {
  if (!price || !qty || !unit || !BASIS[unit]) return null;
  const b = BASIS[unit];
  return { value: round((price / qty) * b.per), label: b.label, unit };
}

// Words that appear on every other product and carry no identifying signal.
const STOP = new Set([
  'pack', 'packet', 'combo', 'set', 'box', 'tub', 'pouch', 'bottle', 'jar', 'can',
  'tetra', 'refill', 'fresh', 'premium', 'natural', 'pure', 'classic', 'original',
  'of', 'the', 'and', 'with', 'for', 'in', 'no', 'x', 'free', 'new', 'value',
]);

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9%+\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * A coarse key used to bucket the same product across platforms before the
 * finer-grained scoring in match.js runs. Deliberately lossy: brand + the two
 * most distinctive product words + normalised size.
 */
export function buildMatchKey(name, brand, parsed) {
  const t = tokens(name);
  const b = tokens(brand).slice(0, 2);
  const rest = t.filter((w) => !b.includes(w)).slice(0, 3);
  const size = parsed ? `${parsed.qty}${parsed.unit}` : 'na';
  return [...b, ...rest].sort().join('-') + '|' + size;
}

export { tokens };

/**
 * How well a product answers the query.
 *
 * Platforms pad search results with "you might also like" filler — a search for
 * "amul butter" comes back with bread and buttermilk. Those aren't wrong for
 * the platform's purposes, but they're noise in a price comparison, so we score
 * overlap against the query and let the caller rank or drop the tail.
 */
export function relevance(query, name, brand) {
  const q = tokens(query);
  if (!q.length) return 1;
  const hay = new Set([...tokens(name), ...tokens(brand)]);
  let hits = 0;
  for (const t of q) {
    if (hay.has(t)) { hits += 1; continue; }
    // Credit partial stems so "butter" still matches "buttermilk" — weakly.
    for (const h of hay) {
      if (h.length > 3 && (h.startsWith(t) || t.startsWith(h))) { hits += 0.5; break; }
    }
  }
  return hits / q.length;
}

/**
 * Descriptor sets whose members are mutually exclusive. If two names each carry
 * a different member of the same set, they are different products no matter how
 * much else they share.
 *
 * This exists because token overlap alone scored "Amul Salted Butter" against
 * "Amul Unsalted Cooking Butter" at 0.73 — same brand, same size, one letter of
 * difference in meaning, and a confident recommendation to buy the wrong thing.
 * Silently grouping opposites is worse than showing two separate rows.
 */
const VARIANT_SETS = [
  ['salted', 'unsalted'],
  ['sweetened', 'unsweetened'],
  ['toned', 'skimmed', 'standardized', 'slim'],   // milk fat grades
  ['veg', 'nonveg'],
  ['white', 'brown', 'multigrain'],               // bread/sugar/rice
  ['regular', 'diet', 'lite', 'zero'],
];

/** True when the two names are provably different variants of one product. */
function variantConflict(ta, tb) {
  for (const set of VARIANT_SETS) {
    const inA = set.filter((w) => ta.has(w));
    const inB = set.filter((w) => tb.has(w));
    if (inA.length && inB.length && !inA.some((w) => inB.includes(w))) return true;
  }
  // Generic negation: "unsalted" vs "salted", "unsweetened" vs "sweetened".
  for (const [x, y] of [[ta, tb], [tb, ta]]) {
    for (const t of x) {
      if (t.startsWith('un') && t.length > 4 && y.has(t.slice(2)) && !x.has(t.slice(2))) return true;
    }
  }
  return false;
}

/**
 * Similarity, used to decide whether two listings are the same physical SKU.
 *
 * Two hard gates run before any scoring, because a false match here produces a
 * confidently wrong "cheapest" — the single worst failure this app can have:
 *
 *   1. Pack size must agree. Different sizes are different SKUs and get their
 *      own rows; comparing across sizes is what price-per-unit is for.
 *   2. No conflicting variant descriptors (see above).
 */
export function similarity(a, b) {
  const ta = new Set(tokens(a.name));
  const tb = new Set(tokens(b.name));
  if (!ta.size || !tb.size) return 0;

  // Gate 1: size. Unknown size on either side is tolerated; a known mismatch is not.
  if (a.qty && b.qty) {
    if (a.unit !== b.unit) return 0;
    if (Math.min(a.qty, b.qty) / Math.max(a.qty, b.qty) < 0.95) return 0;
  }

  // Gate 2: contradictory variants.
  if (variantConflict(ta, tb)) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jac = inter / (ta.size + tb.size - inter);

  const ba = tokens(a.brand).join(' ');
  const bb = tokens(b.brand).join(' ');
  let brandScore = 0.5;
  if (ba && bb) brandScore = ba === bb ? 1 : (ba.includes(bb) || bb.includes(ba) ? 0.8 : 0);

  // Different brands are different products, full stop — no amount of shared
  // generic words ("fresh", "butter") should bridge Amul and Nutralite.
  if (brandScore === 0) return 0;

  return 0.6 * jac + 0.4 * brandScore;
}
