#!/usr/bin/env node
/**
 * Offline correctness tests — no network, no browser. Run with `npm test`.
 *
 * These cover the two places where a bug produces a confidently wrong answer
 * rather than an obvious failure: unit normalisation (which decides what
 * "cheaper" means) and product matching (which decides what's being compared).
 */
import { parseUnit, pricePerUnit, similarity, relevance } from '../src/normalize.js';
import { optimiseBasket } from '../src/engine/basket.js';
import { assessRun } from '../src/engine/quality.js';
import { makeCapturedAdapter, pluck, findItemArray } from '../src/adapters/captured.js';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

console.log('\nunit parsing');
const units = {
  '500 g': '500g', '1 ltr': '1000ml', '1 L': '1000ml', '250ml': '250ml',
  '2 x 200 ml': '400ml', 'Pack of 6': '6pcs', '6 x 100 g': '600g', '1 kg': '1000g',
  '12 pcs': '12pcs', '1 dozen': '12pcs', '1.5 L': '1500ml', '450 ml': '450ml',
  'Combo of 4': '4pcs', 'Nestle a+ 100 250 ml': '250ml', '6': '6pcs', '1 piece': '1pcs',
  // Zepto's format — the multipack cases must multiply, not take the inner size.
  '1 pack (100 g)': '100g', '2 pack (500 ml)': '1000ml', '3 packs (75 g)': '225g',
  '1 pack (1 kg)': '1000g', '1 pack (50 x 20 g)': '1000g',
};
for (const [input, want] of Object.entries(units)) {
  const p = parseUnit(input);
  const got = p ? `${p.qty}${p.unit}` : 'null';
  t(`${input.padEnd(22)} -> ${got}`, got === want, `want ${want}`);
}

console.log('\nprice per unit');
t('1L @ ₹72 = ₹72/L', pricePerUnit(72, 1000, 'ml').value === 72);
t('500ml @ ₹40 = ₹80/L (bigger pack wins)', pricePerUnit(40, 500, 'ml').value === 80);
t('100g @ ₹63 = ₹63/100g', pricePerUnit(63, 100, 'g').value === 63);
t('unknown size -> null', pricePerUnit(50, null, null) === null);

console.log('\nproduct matching — must NOT group');
const P = (name, brand, qty, unit) => ({ name, brand, qty, unit });
const THRESH = 0.62;
const noMatch = [
  ['salted vs unsalted', P('Amul Salted Butter', 'Amul', 100, 'g'), P('Amul Unsalted Cooking Butter', 'Amul', 100, 'g')],
  ['toned vs skimmed', P('Amul Toned Milk', 'Amul', 1000, 'ml'), P('Amul Skimmed Milk', 'Amul', 1000, 'ml')],
  ['different brands', P('Amul Butter', 'Amul', 100, 'g'), P('Nutralite Butter', 'Nutralite', 100, 'g')],
  ['different sizes', P('Amul Gold Milk', 'Amul', 500, 'ml'), P('Amul Gold Milk', 'Amul', 1000, 'ml')],
  ['white vs brown', P('Britannia White Bread', 'Britannia', 400, 'g'), P('Britannia Brown Bread', 'Britannia', 400, 'g')],
  ['sweetened vs unsweetened', P('Amul Sweetened Condensed Milk', 'Amul', 400, 'g'), P('Amul Unsweetened Condensed Milk', 'Amul', 400, 'g')],
  ['g vs ml', P('Amul Butter', 'Amul', 100, 'g'), P('Amul Butter', 'Amul', 100, 'ml')],
];
for (const [name, a, b] of noMatch) {
  const s = similarity(a, b);
  t(`${name.padEnd(26)} (${s.toFixed(2)})`, s < THRESH, `scored ${s.toFixed(2)}, would group`);
}

console.log('\nproduct matching — MUST group');
const yesMatch = [
  ['word order', P('Amul Salted Butter', 'Amul', 100, 'g'), P('Amul Butter Salted', 'Amul', 100, 'g')],
  ['reordered long', P('Amul Gold Full Cream Milk', 'Amul', 1000, 'ml'), P('Amul Gold Milk Full Cream', 'Amul', 1000, 'ml')],
  ['packaging suffix', P('Amul Taaza Toned Milk', 'Amul', 1000, 'ml'), P('Amul Taaza Toned Milk (Tetra)', 'Amul', 1000, 'ml')],
];
for (const [name, a, b] of yesMatch) {
  const s = similarity(a, b);
  t(`${name.padEnd(26)} (${s.toFixed(2)})`, s >= THRESH, `scored ${s.toFixed(2)}, would split`);
}

console.log('\nquery relevance');
t('exact match scores 1', relevance('amul butter', 'Amul Salted Butter', 'Amul') === 1);
t('unrelated scores 0', relevance('amul butter', 'Britannia Milk Bread', 'Britannia') === 0);
{
  // A size in the query is a requirement, not a hint. Ignoring it reported
  // ₹71 as the best price for 5kg atta (it was a 1kg pack).
  const right = relevance('aashirvaad atta 5 kg', 'Aashirvaad Atta', 'Aashirvaad', '5 kg');
  const wrong = relevance('aashirvaad atta 5 kg', 'Aashirvaad Atta', 'Aashirvaad', '1 kg');
  t(`matching size outranks wrong size (${right.toFixed(2)} vs ${wrong.toFixed(2)})`, right > wrong * 2);
  t('wrong size falls below the 0.6 publish bar', wrong < 0.6, `scored ${wrong.toFixed(2)}`);
  t('right size clears the publish bar', right >= 0.6, `scored ${right.toFixed(2)}`);

  const near = relevance('amul milk 1 ltr', 'Amul Gold Milk', 'Amul', '1 L');
  t('equivalent units are not penalised', near >= 0.6, `scored ${near.toFixed(2)}`);

  const noSize = relevance('maggi noodles', 'Maggi Masala Noodles', 'Maggi', '70 g');
  t('no size in query means no size penalty', noSize === 1, `scored ${noSize.toFixed(2)}`);
}

console.log('\nbasket optimisation');
{
  // Blinkit is cheaper per item but charges delivery; Zepto clears free-delivery.
  const mk = (platform, price) => ({
    id: `${platform}:x`, platform, name: 'Item', price, inStock: true, mrp: null, discount: 0,
  });
  const lines = [
    { query: 'a', qty: 1, groups: [{ name: 'a', offers: [mk('blinkit', 100), mk('zepto', 110)] }] },
    { query: 'b', qty: 1, groups: [{ name: 'b', offers: [mk('blinkit', 50), mk('zepto', 95)] }] },
  ];
  const r = optimiseBasket(lines);
  const blink = r.singleCart.find((c) => c.platform === 'blinkit');
  t('subtotal summed correctly', blink.subtotal === 150, `got ${blink.subtotal}`);
  t('delivery fee applied below threshold', blink.delivery === 25, `got ${blink.delivery}`);
  t('total includes fees', blink.total === 150 + 25 + 9, `got ${blink.total}`);
  t('carts ranked by total', r.singleCart[0].total <= r.singleCart[1].total);
  t('a recommendation is produced', !!r.recommendation);

  // With one line unavailable everywhere but Zepto, Blinkit must not "win".
  const lines2 = [
    { query: 'a', qty: 1, groups: [{ name: 'a', offers: [mk('blinkit', 10), mk('zepto', 20)] }] },
    { query: 'b', qty: 1, groups: [{ name: 'b', offers: [mk('zepto', 20)] }] },
  ];
  const r2 = optimiseBasket(lines2);
  t('incomplete cart ranked below complete', r2.singleCart[0].complete === true);
}

console.log('\nscrape quality gate');
{
  const S = (o) => new Map(Object.entries(o));
  const ALL = ['blinkit', 'zepto', 'dmart', 'flipkart'];

  // The real GitHub-runner failure: quick-commerce enabled, all returned zero,
  // only the marketplace responded. Must be flagged.
  let r = assessRun(S({ blinkit: { offers: 0 }, zepto: { offers: 0 }, dmart: { offers: 0 }, flipkart: { offers: 354 } }), ALL);
  t('flags a run where quick-commerce returned nothing', r.degraded === true);
  t('gives a reason when degraded', !!r.reason);

  r = assessRun(S({ blinkit: { offers: 19 }, zepto: { offers: 17 }, dmart: { offers: 0 }, flipkart: { offers: 24 } }), ALL);
  t('healthy run is not flagged', r.degraded === false);

  // One working quick-commerce platform is enough to trust the run.
  r = assessRun(S({ blinkit: { offers: 3 }, zepto: { offers: 0 } }), ['blinkit', 'zepto']);
  t('a single working platform is enough', r.degraded === false);

  // Deliberately configuring only Flipkart is a choice, not a failure.
  r = assessRun(S({ flipkart: { offers: 100 } }), ['flipkart']);
  t('marketplace-only config is not flagged', r.degraded === false);

  // Everything failed, quick-commerce enabled.
  r = assessRun(S({}), ALL);
  t('total failure is flagged', r.degraded === true);
}

console.log('\ncaptured mobile-API mapping');
{
  // Shaped like a real quick-commerce mobile response: products buried under
  // nested keys, prices in a sub-object, plus decoy arrays of banners.
  const payload = {
    meta: { ok: true },
    layout: {
      banners: [{ id: 'b1', title: 'Sale' }, { id: 'b2', title: 'New' }],
      widgets: [{
        type: 'grid',
        products: [
          { id: 'p1', title: 'Amul Gold Milk', quantity: '1 L',   price: { value: 79, mrp: 85 }, available: true },
          { id: 'p2', title: 'Amul Taaza Milk', quantity: '500 ml', price: { value: 29, mrp: 29 }, available: true },
          { id: 'p3', title: 'Nandini Milk',    quantity: '1 L',   price: { value: 46, mrp: 52 }, available: false },
        ],
      }],
    },
  };

  const found = findItemArray(payload);
  t('auto-detects the product array over decoys', found.length === 3, `found ${found.length}`);

  t('pluck reads nested paths', pluck(payload, 'layout.widgets[0].products[1].price.value') === 29);
  t('pluck survives a missing path', pluck(payload, 'a.b.c') === undefined);

  const cfg = {
    platform: 'flipkart-minutes', label: 'Flipkart Minutes',
    request: { url: 'https://example.invalid' },
    map: { id: 'id', name: 'title', unitText: 'quantity', price: 'price.value', mrp: 'price.mrp', inStock: 'available' },
  };
  // Exercise the mapping directly, without a network call.
  const mapped = found.map((it) => ({
    name: pluck(it, cfg.map.name),
    price: pluck(it, cfg.map.price),
    mrp: pluck(it, cfg.map.mrp),
    unitText: pluck(it, cfg.map.unitText),
    inStock: !!pluck(it, cfg.map.inStock),
  }));
  t('maps name and price', mapped[0].name === 'Amul Gold Milk' && mapped[0].price === 79);
  t('maps pack size for price-per-unit', mapped[1].unitText === '500 ml');
  t('carries stock state through', mapped[2].inStock === false);
  t('adapter id matches the platform key', makeCapturedAdapter(cfg).id === 'flipkart-minutes');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
