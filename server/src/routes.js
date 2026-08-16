import { db, getCache, setCache, priceHistory, trailingMedian,
         getSetting, setSetting, currentDeals } from './db.js';
import { config, saveLocation } from './config.js';
import { CITIES, nearestCity } from './cities.js';
import { searchAll, ALL_ADAPTERS } from './adapters/index.js';
import { groupOffers } from './match.js';
import { relevance, pricePerUnit } from './normalize.js';
import { optimiseBasket } from './engine/basket.js';
import { evaluateOffer, sparkline } from './engine/deals.js';
import { runCycle, pollerStatus, startPoller, stopPoller } from './engine/poller.js';
import { checkRescue, rescueStatus, startRescue, stopRescue } from './engine/rescue.js';
import { pushReady } from './engine/push.js';
import { setLocationCookies } from './browser.js';
import { bus } from './engine/bus.js';
import { PLATFORM_META } from './adapters/base.js';

/**
 * Search, with a short cache. Quick-commerce prices don't move second to
 * second, and every uncached call spins up real page loads — so a 5-minute
 * cache is the difference between snappy and unusable. `?fresh=1` bypasses it.
 */
async function doSearch(query, { platforms, fresh } = {}) {
  const key = `s:${query.toLowerCase()}:${(platforms || config.platforms).join(',')}`;
  if (!fresh) {
    const hit = getCache(key, config.searchCacheMs);
    if (hit) return { ...hit.data, cached: true, cachedAt: hit.ts };
  }

  const results = await searchAll(query, { platforms });
  const all = groupOffers(results);

  // Rank by how well each group actually answers the query, then by how many
  // platforms it lets you compare. Platforms pad results with loosely-related
  // filler; scoring it here keeps the top of the list honest without throwing
  // away the tail entirely.
  for (const g of all) {
    g.relevance = Math.max(...g.offers.map((o) => relevance(query, o.name, o.brand)));
    for (const o of g.offers) {
      const evaluated = evaluateOffer(o, null);
      o.deal = { score: evaluated.score, signals: evaluated.signals, median: evaluated.median };
    }
    g.dealScore = Math.max(0, ...g.offers.map((o) => o.deal.score));
  }

  const groups = all
    .filter((g) => g.relevance > 0)
    .sort((a, b) => {
      // Comparable-across-platforms beats a marginally better text match.
      const rel = Math.round(b.relevance * 4) - Math.round(a.relevance * 4);
      if (rel) return rel;
      if (b.platformCount !== a.platformCount) return b.platformCount - a.platformCount;
      return (b.maxSaving || 0) - (a.maxSaving || 0);
    });

  const payload = {
    query,
    groups,
    platforms: results.map((r) => ({
      platform: r.platform, ok: r.ok, ms: r.ms, count: r.offers.length,
      error: r.error || null, blocked: !!r.blocked, meta: PLATFORM_META[r.platform],
    })),
    ts: Date.now(),
    cached: false,
  };
  setCache(key, payload);
  return payload;
}

export function registerRoutes(app) {
  // ---------- meta ----------
  app.get('/api/health', async () => ({
    ok: true,
    location: config.location,
    platforms: config.platforms,
    adapters: Object.keys(ALL_ADAPTERS),
    push: pushReady(),
    vapidPublicKey: config.vapid.publicKey || null,
    poller: pollerStatus(),
    rescue: rescueStatus(),
    platformMeta: PLATFORM_META,
  }));

  app.get('/api/cities', async () => CITIES);

  app.post('/api/location', async (req) => {
    const { lat, lon, locality, pincode, cityId } = req.body || {};

    // A city id is the easy path: it carries coordinates AND a pincode, which
    // the pincode-gated platforms need and GPS alone can't give us.
    if (cityId) {
      const c = CITIES.find((x) => x.id === cityId);
      if (!c) throw app.httpErrors.badRequest('unknown city');
      saveLocation({ lat: c.lat, lon: c.lon, locality: c.name, pincode: c.pincode });
    } else {
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        throw app.httpErrors.badRequest('lat and lon must be numbers');
      }
      if (pincode && !/^\d{6}$/.test(String(pincode))) {
        throw app.httpErrors.badRequest('pincode must be 6 digits');
      }
      // Coming from GPS there's no pincode; borrow the nearest city's so the
      // pincode-gated platforms still return something.
      const guess = pincode || nearestCity(lat, lon)?.pincode || config.location.pincode;
      saveLocation({ lat, lon, locality, pincode: guess });
    }

    await setLocationCookies();
    db.prepare('DELETE FROM search_cache').run();   // prices are location-specific
    return { ok: true, location: config.location };
  });

  // ---------- search ----------
  app.get('/api/search', async (req) => {
    const q = String(req.query.q || '').trim();
    if (!q) throw app.httpErrors.badRequest('q is required');
    const platforms = req.query.platforms ? String(req.query.platforms).split(',') : null;
    return doSearch(q, { platforms, fresh: req.query.fresh === '1' });
  });

  // ---------- watches ----------
  app.get('/api/watches', async () => {
    const rows = db.prepare('SELECT * FROM watch ORDER BY created_at DESC').all();
    return rows.map((w) => {
      const latest = db.prepare(`
        SELECT p.id, p.name, p.platform, p.image, p.unit_text, pp.price, pp.mrp, pp.in_stock, pp.ts
        FROM product p
        JOIN price_point pp ON pp.product_id = p.id
        WHERE (? IS NULL OR p.match_key = ?)
          AND pp.ts = (SELECT MAX(ts) FROM price_point WHERE product_id = p.id)
          AND p.last_seen > ?
        ORDER BY pp.price ASC LIMIT 6
      `).all(w.match_key, w.match_key, Date.now() - 7 * 864e5);
      return { ...w, current: latest, best: latest[0] || null };
    });
  });

  app.post('/api/watches', async (req) => {
    const b = req.body || {};
    if (!b.query) throw app.httpErrors.badRequest('query is required');
    const info = db.prepare(`
      INSERT INTO watch (query, label, match_key, target_price, min_discount, notify_restock, platforms, active, created_at)
      VALUES (?,?,?,?,?,?,?,1,?)
    `).run(
      b.query, b.label || b.query, b.matchKey || null,
      b.targetPrice ?? null, b.minDiscount ?? null,
      b.notifyRestock ? 1 : 0,
      Array.isArray(b.platforms) && b.platforms.length ? b.platforms.join(',') : null,
      Date.now()
    );
    // Prime it immediately so the card isn't empty while you're looking at it.
    runCycle({ watchId: info.lastInsertRowid }).catch(() => {});
    return { ok: true, id: info.lastInsertRowid };
  });

  app.patch('/api/watches/:id', async (req) => {
    const b = req.body || {};
    const fields = [];
    const vals = [];
    const map = {
      label: 'label', targetPrice: 'target_price', minDiscount: 'min_discount',
      notifyRestock: 'notify_restock', active: 'active', matchKey: 'match_key',
    };
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) {
        fields.push(`${col} = ?`);
        vals.push(typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k]);
      }
    }
    if (!fields.length) return { ok: true };
    vals.push(req.params.id);
    db.prepare(`UPDATE watch SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  app.delete('/api/watches/:id', async (req) => {
    db.prepare('DELETE FROM watch WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/watches/:id/check', async (req) => runCycle({ watchId: Number(req.params.id) }));

  // ---------- history ----------
  app.get('/api/history/:productId', async (req) => {
    const id = decodeURIComponent(req.params.productId);
    const days = Number(req.query.days || 30);
    return {
      productId: id,
      points: sparkline(id, days),
      median: trailingMedian(id, days),
      raw: priceHistory(id, days).length,
    };
  });

  // ---------- lists ----------
  app.get('/api/lists', async () => {
    const lists = db.prepare('SELECT * FROM basket_list ORDER BY id').all();
    const counts = db.prepare('SELECT list_id, COUNT(*) c FROM basket_item GROUP BY list_id').all();
    const byId = Object.fromEntries(counts.map((c) => [c.list_id, c.c]));
    return lists.map((l) => ({ ...l, count: byId[l.id] || 0 }));
  });

  app.post('/api/lists', async (req) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw app.httpErrors.badRequest('name is required');
    const info = db.prepare('INSERT INTO basket_list (name, created_at) VALUES (?,?)').run(name, Date.now());
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/lists/:id', async (req) => {
    const name = String(req.body?.name || '').trim();
    if (name) db.prepare('UPDATE basket_list SET name = ? WHERE id = ?').run(name, Number(req.params.id));
    return { ok: true };
  });

  app.delete('/api/lists/:id', async (req) => {
    const id = Number(req.params.id);
    const total = db.prepare('SELECT COUNT(*) c FROM basket_list').get().c;
    // Never leave the app with zero lists — there'd be nowhere to add items.
    if (total <= 1) throw app.httpErrors.badRequest('cannot delete your only list');
    db.prepare('DELETE FROM basket_item WHERE list_id = ?').run(id);
    db.prepare('DELETE FROM basket_list WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---------- basket ----------
  const defaultListId = () => db.prepare('SELECT id FROM basket_list ORDER BY id LIMIT 1').get()?.id;

  app.get('/api/basket', async (req) => {
    const listId = Number(req.query.listId) || defaultListId();
    return db.prepare('SELECT * FROM basket_item WHERE list_id = ? ORDER BY added_at').all(listId);
  });

  app.post('/api/basket', async (req) => {
    const { query, qty, listId } = req.body || {};
    if (!query) throw app.httpErrors.badRequest('query is required');
    const list = Number(listId) || defaultListId();
    const info = db.prepare('INSERT INTO basket_item (query, qty, added_at, list_id) VALUES (?,?,?,?)')
      .run(query, qty || 1, Date.now(), list);
    return { ok: true, id: Number(info.lastInsertRowid), listId: list };
  });

  app.patch('/api/basket/:id', async (req) => {
    const { qty } = req.body || {};
    if (qty != null) db.prepare('UPDATE basket_item SET qty = ? WHERE id = ?').run(qty, req.params.id);
    return { ok: true };
  });

  app.delete('/api/basket/:id', async (req) => {
    db.prepare('DELETE FROM basket_item WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/basket/optimise', async (req) => {
    const listId = Number(req.body?.listId) || defaultListId();
    const items = db.prepare('SELECT * FROM basket_item WHERE list_id = ? ORDER BY added_at').all(listId);
    if (!items.length) return { lines: [], singleCart: [], split: null, recommendation: null };

    const fresh = req.body?.fresh === true;
    const lines = [];
    for (const it of items) {
      const res = await doSearch(it.query, { fresh });
      // Only the top few candidates per line — enough to price it, not so many
      // that an unrelated match hijacks the basket.
      lines.push({ query: it.query, qty: it.qty, id: it.id, groups: res.groups.slice(0, 4) });
    }
    const opt = optimiseBasket(lines, { feeOverrides: getSetting('fees', null) });
    return { listId, lines: lines.map((l) => ({ query: l.query, qty: l.qty, id: l.id })), ...opt };
  });

  // ---------- fees ----------
  app.get('/api/fees', async () => {
    const saved = getSetting('fees', {}) || {};
    // Merge so the UI always sees every platform, defaults where unedited.
    return Object.fromEntries(Object.entries(PLATFORM_META).map(([k, v]) => [k, { ...v, ...(saved[k] || {}) }]));
  });

  app.post('/api/fees', async (req) => {
    const body = req.body || {};
    const clean = {};
    for (const [platform, v] of Object.entries(body)) {
      if (!PLATFORM_META[platform]) continue;
      const n = (x, d) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : d);
      clean[platform] = {
        deliveryFee: n(v.deliveryFee, PLATFORM_META[platform].deliveryFee),
        handling: n(v.handling, PLATFORM_META[platform].handling),
        freeAbove: n(v.freeAbove, PLATFORM_META[platform].freeAbove),
      };
    }
    setSetting('fees', clean);
    return { ok: true, fees: clean };
  });

  app.post('/api/fees/reset', async () => { setSetting('fees', {}); return { ok: true }; });

  // ---------- deals ----------
  app.get('/api/deals', async (req) => {
    const deals = currentDeals({
      days: Number(req.query.days || 3),
      limit: Number(req.query.limit || 40),
      minScore: Number(req.query.minScore || 20),
    });
    return deals.map((d) => ({
      ...d,
      meta: PLATFORM_META[d.platform] || { label: d.platform, color: '#888' },
      ppu: pricePerUnit(d.price, d.qty, d.unit),
    }));
  });

  // ---------- export ----------
  app.get('/api/export/history.csv', async (req, reply) => {
    const days = Number(req.query.days || 90);
    const rows = db.prepare(`
      SELECT p.platform, p.name, p.brand, p.unit_text, p.qty, p.unit,
             pp.price, pp.mrp, pp.in_stock, pp.ts
      FROM price_point pp JOIN product p ON p.id = pp.product_id
      WHERE pp.ts > ? ORDER BY p.name, pp.ts
    `).all(Date.now() - days * 864e5);

    // Quote every field and double internal quotes — product names contain
    // commas and quotes routinely ("Amul Gold 1L, Pack of 2").
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['timestamp_iso', 'platform', 'product', 'brand', 'pack', 'qty', 'unit',
                    'price_inr', 'mrp_inr', 'in_stock', 'price_per_unit'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const ppu = pricePerUnit(r.price, r.qty, r.unit);
      lines.push([
        new Date(r.ts).toISOString(), r.platform, r.name, r.brand, r.unit_text,
        r.qty, r.unit, r.price, r.mrp, r.in_stock ? 'yes' : 'no',
        ppu ? `${ppu.value}/${ppu.label}` : '',
      ].map(esc).join(','));
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="quickcompare-history-${new Date().toISOString().slice(0, 10)}.csv"`)
      // Excel assumes the system codepage without a BOM and mangles ₹ and names.
      .send('﻿' + lines.join('\n'));
  });

  // ---------- alerts ----------
  app.get('/api/alerts', async (req) => {
    const limit = Number(req.query.limit || 50);
    return db.prepare('SELECT * FROM alert ORDER BY ts DESC LIMIT ?').all(limit)
      .map((a) => ({ ...a, payload: a.payload ? JSON.parse(a.payload) : null }));
  });

  app.post('/api/alerts/seen', async () => {
    db.prepare('UPDATE alert SET seen = 1 WHERE seen = 0').run();
    return { ok: true };
  });

  app.delete('/api/alerts', async () => { db.prepare('DELETE FROM alert').run(); return { ok: true }; });

  // ---------- push ----------
  app.post('/api/push/subscribe', async (req) => {
    const sub = req.body;
    if (!sub?.endpoint) throw app.httpErrors.badRequest('invalid subscription');
    db.prepare('INSERT OR REPLACE INTO push_sub (endpoint, sub, created_at) VALUES (?,?,?)')
      .run(sub.endpoint, JSON.stringify(sub), Date.now());
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    if (req.body?.endpoint) db.prepare('DELETE FROM push_sub WHERE endpoint = ?').run(req.body.endpoint);
    return { ok: true };
  });

  app.post('/api/push/test', async () => {
    const { notify } = await import('./engine/push.js');
    await notify({
      kind: 'test',
      title: 'QuickCompare is armed',
      body: 'Price drops and rescue alerts will land here.',
      url: '/',
    });
    return { ok: true, subscribers: db.prepare('SELECT COUNT(*) c FROM push_sub').get().c };
  });

  // ---------- rescue ----------
  app.get('/api/rescue/status', async () => rescueStatus());
  app.post('/api/rescue/check', async () => checkRescue());
  app.post('/api/rescue/toggle', async (req) => {
    if (req.body?.enabled) startRescue(); else stopRescue();
    return rescueStatus();
  });

  // ---------- poller ----------
  app.get('/api/poller', async () => pollerStatus());
  app.post('/api/poller/run', async () => runCycle());
  app.post('/api/poller/toggle', async (req) => {
    if (req.body?.enabled) startPoller(); else stopPoller();
    return pollerStatus();
  });

  // ---------- diagnostics ----------
  app.get('/api/diagnostics', async () => {
    const logs = db.prepare('SELECT * FROM scrape_log ORDER BY ts DESC LIMIT 60').all();
    const byPlatform = {};
    for (const l of db.prepare('SELECT * FROM scrape_log WHERE ts > ?').all(Date.now() - 864e5)) {
      const b = (byPlatform[l.platform] ||= { ok: 0, fail: 0, avgMs: 0, n: 0, lastError: null });
      if (l.ok) b.ok++; else { b.fail++; b.lastError = l.error; }
      b.avgMs = Math.round((b.avgMs * b.n + (l.ms || 0)) / (b.n + 1));
      b.n++;
    }
    return {
      byPlatform, recent: logs,
      counts: {
        products: db.prepare('SELECT COUNT(*) c FROM product').get().c,
        pricePoints: db.prepare('SELECT COUNT(*) c FROM price_point').get().c,
        watches: db.prepare('SELECT COUNT(*) c FROM watch WHERE active=1').get().c,
        alerts: db.prepare('SELECT COUNT(*) c FROM alert').get().c,
        pushSubs: db.prepare('SELECT COUNT(*) c FROM push_sub').get().c,
      },
    };
  });

  // ---------- live stream ----------
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const send = (event, data) => {
      try { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };
    const onAlert = (d) => send('alert', d);
    const onPoll = (d) => send('poll', d);
    const onRescue = (d) => send('rescue', d);
    const onWatch = (d) => send('watch-updated', d);

    bus.on('alert', onAlert);
    bus.on('poll', onPoll);
    bus.on('rescue', onRescue);
    bus.on('watch-updated', onWatch);

    const ka = setInterval(() => { try { reply.raw.write(': ka\n\n'); } catch { /* ignore */ } }, 25000);

    req.raw.on('close', () => {
      clearInterval(ka);
      bus.off('alert', onAlert);
      bus.off('poll', onPoll);
      bus.off('rescue', onRescue);
      bus.off('watch-updated', onWatch);
    });
  });
}
