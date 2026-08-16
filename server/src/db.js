import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Node's built-in SQLite. Deliberately chosen over better-sqlite3: that one
// needs a native build toolchain (Visual Studio on Windows), which turns a
// two-minute setup into an afternoon. This has zero native dependencies.
export const db = new DatabaseSync(path.join(DATA_DIR, 'quickcompare.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS product (
  id            TEXT PRIMARY KEY,          -- platform:native_id
  platform      TEXT NOT NULL,
  native_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  brand         TEXT,
  unit_text     TEXT,                      -- "500 g", "1 ltr" as shown
  qty           REAL,                      -- normalized magnitude
  unit          TEXT,                      -- g | ml | pcs
  image         TEXT,
  url           TEXT,
  category      TEXT,
  match_key     TEXT,                      -- cross-platform grouping key
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_match ON product(match_key);
CREATE INDEX IF NOT EXISTS idx_product_platform ON product(platform);

-- Append-only price observations. This is what powers history, trailing
-- medians and "is this actually a good deal or just theatre" checks.
CREATE TABLE IF NOT EXISTS price_point (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  TEXT NOT NULL,
  price       REAL NOT NULL,
  mrp         REAL,
  in_stock    INTEGER NOT NULL DEFAULT 1,
  eta         TEXT,
  ts          INTEGER NOT NULL,
  FOREIGN KEY(product_id) REFERENCES product(id)
);
CREATE INDEX IF NOT EXISTS idx_pp_product_ts ON price_point(product_id, ts DESC);

-- Things you're tracking. A watch is keyed on a search term so it keeps
-- working even when a platform rotates its internal product ids.
CREATE TABLE IF NOT EXISTS watch (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  query          TEXT NOT NULL,
  label          TEXT,
  match_key      TEXT,
  target_price   REAL,                     -- notify at or below this
  min_discount   INTEGER,                  -- notify at/above this % off MRP
  notify_restock INTEGER NOT NULL DEFAULT 0,
  platforms      TEXT,                     -- CSV filter, NULL = all
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  last_checked   INTEGER
);

CREATE TABLE IF NOT EXISTS alert (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id    INTEGER,
  product_id  TEXT,
  kind        TEXT NOT NULL,               -- target | discount | drop | restock | rescue
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     TEXT,
  ts          INTEGER NOT NULL,
  seen        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_ts ON alert(ts DESC);

CREATE TABLE IF NOT EXISTS push_sub (
  endpoint   TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Named shopping lists ("Weekly", "Monthly stock-up"). One is always default.
CREATE TABLE IF NOT EXISTS basket_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS basket_item (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  query    TEXT NOT NULL,
  qty      INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL
);

-- Small key/value store for things you edit in the app (fee overrides today).
CREATE TABLE IF NOT EXISTS setting (
  key  TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_cache (
  key   TEXT PRIMARY KEY,
  json  TEXT NOT NULL,
  ts    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rescue_seen (
  id   TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scrape_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  query    TEXT,
  ok       INTEGER NOT NULL,
  count    INTEGER,
  ms       INTEGER,
  error    TEXT,
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scrape_ts ON scrape_log(ts DESC);
`);

/**
 * Additive migrations. The schema above uses CREATE TABLE IF NOT EXISTS, which
 * does nothing to a table that already exists — so new columns on old tables
 * have to be added explicitly, guarded, or an existing install breaks on boot.
 */
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

if (!hasColumn('basket_item', 'list_id')) {
  db.exec('ALTER TABLE basket_item ADD COLUMN list_id INTEGER');
}

// Guarantee exactly one default list exists, and adopt any pre-existing items.
{
  const first = db.prepare('SELECT id FROM basket_list ORDER BY id LIMIT 1').get();
  const defaultId = first
    ? first.id
    : Number(db.prepare('INSERT INTO basket_list (name, created_at) VALUES (?,?)')
        .run('My list', Date.now()).lastInsertRowid);
  db.prepare('UPDATE basket_item SET list_id = ? WHERE list_id IS NULL').run(defaultId);
}

const now = () => Date.now();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT json FROM setting WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.json); } catch { return fallback; }
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO setting (key, json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
    .run(key, JSON.stringify(value));
  return value;
}

/**
 * Current best deals across everything we've ever priced.
 *
 * Uses the same "must beat its own history" rule as the alert engine, so this
 * view can't fill up with permanent fake discounts. Returns the latest price
 * per product, scored, filtered to items seen recently and actually in stock.
 */
export function currentDeals({ days = 3, limit = 40, minScore = 20 } = {}) {
  const rows = db.prepare(`
    SELECT p.id, p.platform, p.name, p.brand, p.image, p.unit_text, p.qty, p.unit, p.url,
           pp.price, pp.mrp, pp.in_stock, pp.ts
    FROM product p
    JOIN price_point pp ON pp.id = (
      SELECT id FROM price_point WHERE product_id = p.id ORDER BY ts DESC LIMIT 1
    )
    WHERE p.last_seen > ? AND pp.in_stock = 1
  `).all(Date.now() - days * 864e5);

  const countStmt = db.prepare(
    'SELECT COUNT(*) c FROM price_point WHERE product_id = ? AND ts > ?'
  );

  const out = [];
  for (const r of rows) {
    const observations = countStmt.get(r.id, Date.now() - 30 * 864e5).c;
    const median = trailingMedian(r.id, 30);
    const vsMrp = r.mrp && r.mrp > r.price ? Math.round(((r.mrp - r.price) / r.mrp) * 100) : 0;
    const vsMedian = median && median > r.price ? Math.round(((median - r.price) / median) * 100) : 0;

    // With fewer than three observations the median is just the current price,
    // so the history signal is structurally zero and the normal formula hides
    // everything. Fall back to MRP-only scoring and mark it as unproven rather
    // than showing a new install an empty screen for a week.
    const hasHistory = observations >= 3;
    const score = hasHistory
      ? Math.min(100, Math.round(vsMedian * 2.2 + vsMrp * 0.8))
      : Math.min(100, Math.round(vsMrp * 1.2));

    if (score < minScore) continue;
    out.push({ ...r, median, vsMrp, vsMedian, score, hasHistory, observations });
  }
  return out.sort((a, b) => {
    // History-backed deals outrank MRP-only ones at equal score, because the
    // MRP number is the one platforms can invent.
    if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
    return b.score - a.score;
  }).slice(0, limit);
}

const upsertProductStmt = db.prepare(`
INSERT INTO product (id, platform, native_id, name, brand, unit_text, qty, unit, image, url, category, match_key, first_seen, last_seen)
VALUES (@id, @platform, @native_id, @name, @brand, @unit_text, @qty, @unit, @image, @url, @category, @match_key, @ts, @ts)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, brand=excluded.brand, unit_text=excluded.unit_text,
  qty=excluded.qty, unit=excluded.unit, image=excluded.image, url=excluded.url,
  category=excluded.category, match_key=excluded.match_key, last_seen=excluded.last_seen
`);

const insertPriceStmt = db.prepare(`
INSERT INTO price_point (product_id, price, mrp, in_stock, eta, ts)
VALUES (?, ?, ?, ?, ?, ?)
`);

const lastPriceStmt = db.prepare(`
SELECT price, mrp, in_stock, ts FROM price_point WHERE product_id = ? ORDER BY ts DESC LIMIT 1
`);

/**
 * Persist a scraped offer and record a price observation — but only write a new
 * price row when something actually changed (or enough time passed). Otherwise a
 * 15-minute poller would bloat the table with millions of identical rows.
 */
export function recordOffer(offer) {
  const ts = now();
  upsertProductStmt.run({
    id: offer.id,
    platform: offer.platform,
    native_id: offer.nativeId,
    name: offer.name,
    brand: offer.brand ?? null,
    unit_text: offer.unitText ?? null,
    qty: offer.qty ?? null,
    unit: offer.unit ?? null,
    image: offer.image ?? null,
    url: offer.url ?? null,
    category: offer.category ?? null,
    match_key: offer.matchKey ?? null,
    ts,
  });

  const prev = lastPriceStmt.get(offer.id);
  const changed =
    !prev ||
    prev.price !== offer.price ||
    (prev.mrp ?? null) !== (offer.mrp ?? null) ||
    !!prev.in_stock !== !!offer.inStock ||
    ts - prev.ts > 6 * 60 * 60 * 1000;

  if (changed) {
    insertPriceStmt.run(offer.id, offer.price, offer.mrp ?? null, offer.inStock ? 1 : 0, offer.eta ?? null, ts);
  }
  return prev || null;
}

export function priceHistory(productId, days = 30) {
  return db.prepare(
    `SELECT price, mrp, in_stock, ts FROM price_point
     WHERE product_id = ? AND ts > ? ORDER BY ts ASC`
  ).all(productId, Date.now() - days * 864e5);
}

/** Trailing median price — the honest baseline a "deal" has to beat. */
export function trailingMedian(productId, days = 30) {
  const rows = db.prepare(
    `SELECT price FROM price_point WHERE product_id = ? AND ts > ? ORDER BY price ASC`
  ).all(productId, Date.now() - days * 864e5);
  if (!rows.length) return null;
  return rows[Math.floor(rows.length / 2)].price;
}

export function logScrape(platform, query, ok, count, ms, error) {
  db.prepare(
    `INSERT INTO scrape_log (platform, query, ok, count, ms, error, ts) VALUES (?,?,?,?,?,?,?)`
  ).run(platform, query ?? null, ok ? 1 : 0, count ?? null, ms ?? null, error ?? null, now());
}

export function addAlert(a) {
  const info = db.prepare(
    `INSERT INTO alert (watch_id, product_id, kind, title, body, payload, ts, seen)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(a.watchId ?? null, a.productId ?? null, a.kind, a.title, a.body,
        a.payload ? JSON.stringify(a.payload) : null, now());
  return info.lastInsertRowid;
}

export function getCache(key, maxAgeMs) {
  const row = db.prepare(`SELECT json, ts FROM search_cache WHERE key = ?`).get(key);
  if (!row || Date.now() - row.ts > maxAgeMs) return null;
  return { data: JSON.parse(row.json), ts: row.ts };
}

export function setCache(key, data) {
  db.prepare(
    `INSERT INTO search_cache (key, json, ts) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET json=excluded.json, ts=excluded.ts`
  ).run(key, JSON.stringify(data), now());
}
