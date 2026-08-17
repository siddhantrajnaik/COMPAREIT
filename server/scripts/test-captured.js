#!/usr/bin/env node
/**
 * Tries one captured config and shows exactly what it extracted, so you can
 * fix the field map without guessing.
 *
 *   npm run captured -- flipkart-minutes milk
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/config.js';
import { makeCapturedAdapter, pluck, findItemArray } from '../src/adapters/captured.js';

const [id, ...rest] = process.argv.slice(2);
const query = rest.join(' ') || 'milk';

if (!id) {
  console.error('Usage: npm run captured -- <platform-id> [search term]');
  const dir = path.join(DATA_DIR, 'captured');
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    console.error(files.length ? `\nAvailable: ${files.map((f) => f.replace('.json', '')).join(', ')}`
                               : '\nNo captured configs yet — see docs/CAPTURE.md');
  }
  process.exit(1);
}

const file = path.join(DATA_DIR, 'captured', `${id}.json`);
if (!fs.existsSync(file)) {
  console.error(`Not found: ${file}\nCopy docs/captured-example.json there and fill it in.`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`Testing "${cfg.label || id}" with query "${query}"\n`);

// Run the raw request first so a mapping problem is distinguishable from a
// transport problem.
const req = cfg.request || {};
const sub = (v) => (typeof v === 'string' ? v.replaceAll('{{query}}', query) : v);
const url = sub(req.url);
const method = (req.method || 'GET').toUpperCase();
const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k, sub(v)]));
let body;
if (method !== 'GET' && req.body != null) {
  const filled = JSON.parse(JSON.stringify(req.body).replaceAll('{{query}}', query));
  body = typeof filled === 'string' ? filled : JSON.stringify(filled);
  headers['content-type'] ||= 'application/json';
}

let res;
try {
  res = await fetch(url, { method, headers, body });
} catch (err) {
  console.error(`Request failed: ${err.message}`);
  console.error('Check the URL is reachable and the host is spelled correctly.');
  process.exit(1);
}

console.log(`HTTP ${res.status} ${res.statusText}`);
if (res.status === 401 || res.status === 403) {
  console.error('\nThe captured auth token has expired. Re-capture it — see docs/CAPTURE.md.');
  process.exit(1);
}
if (!res.ok) { console.error(`\nServer said: ${(await res.text()).slice(0, 300)}`); process.exit(1); }

const json = await res.json();
const map = cfg.map || {};
const items = map.itemsPath ? (pluck(json, map.itemsPath) || []) : findItemArray(json);
console.log(`Found ${items.length} candidate item(s)${map.itemsPath ? '' : ' (auto-detected)'}\n`);

if (!items.length) {
  console.log('No product array detected. Top-level keys were:');
  console.log('  ' + Object.keys(json).join(', '));
  console.log('\nSet "itemsPath" in the map to the array holding the products.');
  process.exit(1);
}

console.log('One raw item, so you can see the real field names:');
console.log(JSON.stringify(items[0], null, 2).split('\n').slice(0, 26).join('\n'));

const offers = await makeCapturedAdapter(cfg).search(query);
console.log(`\nMapped ${offers.length} offer(s):\n`);
for (const o of offers.slice(0, 8)) {
  console.log(`  ${String(o.name).slice(0, 42).padEnd(44)} ${String(o.unitText ?? '—').padEnd(11)} ` +
              `Rs${String(o.price).padEnd(7)} mrp=${String(o.mrp ?? '—').padEnd(6)} ` +
              `${o.ppu ? o.ppu.value + '/' + o.ppu.label : ''}`);
}

const missing = ['name', 'price'].filter((f) => offers.some((o) => o[f] == null));
if (missing.length) console.log(`\nStill unmapped: ${missing.join(', ')} — fix those paths in "map".`);
else if (!offers.some((o) => o.unitText)) console.log('\nTip: map "unitText" to get price-per-unit comparison.');
else console.log('\nLooks good. Add it to PLATFORMS in .env and restart.');

process.exit(0);
