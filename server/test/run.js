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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
