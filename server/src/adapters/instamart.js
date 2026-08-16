import { withPage } from '../browser.js';
import { toOffer, num } from './base.js';
import { assertRendered } from './guard.js';

/**
 * Swiggy Instamart.
 *
 * Instamart's search is an XHR the page fires after hydration, so the most
 * reliable capture is to listen for the response rather than guess at DOM
 * classes (which are hashed and churn constantly). We attach a response
 * listener, navigate, and mine whatever search payload comes back — with a
 * DOM sweep as backstop.
 *
 * Like Zepto, Swiggy serves datacenter IPs an empty body; runs fine from home.
 */
export const instamart = {
  id: 'instamart',
  label: 'Instamart',

  async search(query) {
    const url = `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      const captured = [];

      page.on('response', async (res) => {
        const u = res.url();
        if (!/instamart\/.*search|api\/instamart/i.test(u)) return;
        if (!/json/i.test(res.headers()['content-type'] || '')) return;
        try { captured.push(await res.json()); } catch { /* non-JSON body */ }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      await assertRendered(page, 'Instamart');

      // --- Strategy 1: mine the captured XHR payloads.
      const fromXhr = [];
      const walk = (o, depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 10) return;
        if (Array.isArray(o)) { o.forEach((v) => walk(v, depth + 1)); return; }

        // Instamart variations carry price under a `price` object.
        const v = o.variations?.[0] || o;
        const p = v.price || o.price;
        if (o.display_name && p && (p.offer_price != null || p.mrp != null)) {
          fromXhr.push({
            nativeId: o.product_id || o.id || v.id || o.display_name,
            name: o.display_name,
            brand: o.brand || null,
            unitText: v.quantity || v.sku_quantity_with_combo || o.quantity || null,
            price: num(p.offer_price ?? p.mrp),
            mrp: num(p.mrp),
            image: (v.images || o.images || [])[0]
              ? `https://media-assets.swiggy.com/swiggy/image/upload/${(v.images || o.images)[0]}`
              : null,
            inStock: (v.inventory?.in_stock ?? true) !== false && o.in_stock !== false,
            category: o.category || null,
            url: `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(o.display_name)}`,
          });
        }
        for (const k of Object.keys(o)) walk(o[k], depth + 1);
      };
      captured.forEach((c) => walk(c));

      if (fromXhr.length) {
        const seen = new Set();
        return fromXhr
          .filter((r) => { const k = r.nativeId + r.name; if (seen.has(k)) return false; seen.add(k); return true; })
          .map((r) => toOffer('instamart', r))
          .filter(Boolean);
      }

      // --- Strategy 2: DOM sweep.
      const rows = await page.evaluate(() => {
        const out = [];
        const money = (t) => {
          const m = (t || '').match(/₹\s*([\d,]+(?:\.\d+)?)/);
          return m ? parseFloat(m[1].replace(/,/g, '')) : null;
        };
        const cards = document.querySelectorAll(
          '[data-testid="default_container_ux4"], [data-testid*="product"], div[class*="ProductCard"]'
        );
        for (const card of cards) {
          const txt = card.textContent || '';
          const name = card.querySelector('[class*="name"], h3, h4, .sc-aXZVg')?.textContent?.trim();
          if (!name) continue;
          const prices = [...new Set(
            [...card.querySelectorAll('*')].map((e) => money(e.textContent)).filter((n) => n != null)
          )].sort((a, b) => a - b);
          if (!prices.length) continue;
          out.push({
            nativeId: card.getAttribute('data-item-id') || name,
            name,
            unitText: (txt.match(/(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|ltr|pcs|pack)\b)/i) || [])[1] || null,
            price: prices[0],
            mrp: prices.length > 1 ? prices[prices.length - 1] : null,
            image: card.querySelector('img')?.src || null,
            inStock: !/out of stock|sold out/i.test(txt),
          });
        }
        return out;
      });

      return rows.map((r) => toOffer('instamart', r)).filter(Boolean);
    });
  },
};
