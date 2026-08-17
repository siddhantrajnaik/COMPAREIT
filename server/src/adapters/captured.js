import { toOffer } from './base.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

/**
 * Config-driven adapters built from a request you captured yourself.
 *
 * The web surfaces of Flipkart Minutes, Amazon Now, JioMart and Instamart are
 * either gated behind interactive flows that never initialise under automation,
 * or geo-blocked. Their MOBILE apps have none of those problems: they send
 * lat/lon in a JSON body and get JSON back. No pincode modal, no hydration, no
 * bot wall.
 *
 * So rather than hard-coding endpoints I'd have to guess at, this reads a
 * captured request from data/captured/<id>.json and a small map describing
 * where the fields live. Capture once, and the platform works — no new code.
 *
 * Captured files live under data/ (gitignored) because they carry your auth
 * token. Never commit one.
 */

const CAPTURED_DIR = path.join(DATA_DIR, 'captured');

/** Reads "a.b[0].c" out of a nested object without throwing. */
function pluck(obj, dotPath) {
  if (!dotPath) return undefined;
  return dotPath.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    const m = key.match(/^(.*?)\[(\d+)\]$/);
    if (m) return acc[m[1]]?.[Number(m[2])];
    return acc[key];
  }, obj);
}

/**
 * Finds the product array when `itemsPath` is omitted: the longest array whose
 * entries look like products. Saves you hunting through a 4000-line payload.
 */
function findItemArray(root, maxDepth = 8) {
  let best = null;
  const looksLikeProduct = (o) =>
    o && typeof o === 'object' &&
    Object.keys(o).some((k) => /name|title|display/i.test(k)) &&
    JSON.stringify(o).length < 8000 &&
    /price|mrp|amount|cost/i.test(JSON.stringify(Object.keys(o)));

  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > maxDepth) return;
    if (Array.isArray(node)) {
      if (node.length && node.filter(looksLikeProduct).length >= Math.min(3, node.length)) {
        if (!best || node.length > best.length) best = node;
      }
      node.forEach((v) => walk(v, depth + 1));
      return;
    }
    for (const k of Object.keys(node)) walk(node[k], depth + 1);
  };
  walk(root, 0);
  return best || [];
}

function substitute(value, query) {
  if (typeof value === 'string') return value.replaceAll('{{query}}', query);
  if (Array.isArray(value)) return value.map((v) => substitute(v, query));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, query)]));
  }
  return value;
}

/** Turns one captured-request config into a normal adapter. */
export function makeCapturedAdapter(cfg) {
  return {
    id: cfg.platform,
    label: cfg.label || cfg.platform,
    captured: true,

    async search(query) {
      const req = cfg.request || {};
      const url = substitute(req.url, encodeURIComponent(query));
      const headers = substitute(req.headers || {}, query);
      const method = (req.method || 'GET').toUpperCase();

      let body;
      if (method !== 'GET' && req.body != null) {
        const filled = substitute(req.body, query);
        body = typeof filled === 'string' ? filled : JSON.stringify(filled);
        headers['content-type'] ||= 'application/json';
      }

      const res = await fetch(url, { method, headers, body });
      if (!res.ok) {
        // 401/403 almost always means the captured token expired rather than
        // anything being wrong with the mapping — say so plainly.
        const hint = res.status === 401 || res.status === 403
          ? ' — the captured auth token has probably expired; re-capture it'
          : '';
        throw new Error(`${cfg.label}: HTTP ${res.status}${hint}`);
      }

      const json = await res.json();
      const map = cfg.map || {};
      const items = map.itemsPath ? (pluck(json, map.itemsPath) || []) : findItemArray(json);

      return items.map((it) => toOffer(cfg.platform, {
        nativeId: pluck(it, map.id),
        name: pluck(it, map.name),
        brand: map.brand ? pluck(it, map.brand) : null,
        unitText: map.unitText ? pluck(it, map.unitText) : null,
        price: pluck(it, map.price),
        mrp: map.mrp ? pluck(it, map.mrp) : null,
        image: map.image ? pluck(it, map.image) : null,
        inStock: map.inStock ? !!pluck(it, map.inStock) : true,
        eta: map.eta ? pluck(it, map.eta) : null,
        url: map.url ? pluck(it, map.url) : null,
      })).filter(Boolean);
    },
  };
}

/** Loads every captured config present. Missing directory is not an error. */
export function loadCapturedAdapters() {
  if (!fs.existsSync(CAPTURED_DIR)) return {};
  const out = {};
  for (const file of fs.readdirSync(CAPTURED_DIR)) {
    if (!file.endsWith('.json') || file.startsWith('example')) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(CAPTURED_DIR, file), 'utf8'));
      if (!cfg.platform || !cfg.request?.url) {
        console.warn(`[captured] ${file}: needs "platform" and "request.url" — skipped`);
        continue;
      }
      out[cfg.platform] = makeCapturedAdapter(cfg);
      console.log(`[captured] loaded ${cfg.platform} from ${file}`);
    } catch (err) {
      console.warn(`[captured] ${file}: ${err.message}`);
    }
  }
  return out;
}

export { pluck, findItemArray };
