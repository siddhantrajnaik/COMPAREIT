import { withPage } from '../browser.js';
import { toOffer, num } from './base.js';
import { assertRendered } from './guard.js';

/**
 * BigBasket (includes bbnow / express slots).
 *
 * Classic Next.js — the search page ships a `__NEXT_DATA__` island. We read it
 * directly and fall back to the listing XHR if the island moves.
 */
export const bigbasket = {
  id: 'bigbasket',
  label: 'BigBasket',

  async search(query) {
    const url = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      const captured = [];
      page.on('response', async (res) => {
        if (!/listing-svc|product-svc|\/ps\//.test(res.url())) return;
        if (!/json/i.test(res.headers()['content-type'] || '')) return;
        try { captured.push(await res.json()); } catch { /* ignore */ }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await assertRendered(page, 'BigBasket');

      const rows = await page.evaluate((xhr) => {
        const out = [];
        const sources = [];

        const nd = document.getElementById('__NEXT_DATA__');
        if (nd) { try { sources.push(JSON.parse(nd.textContent)); } catch { /* ignore */ } }
        sources.push(...xhr);

        const walk = (o, depth = 0) => {
          if (!o || typeof o !== 'object' || depth > 10) return;
          if (Array.isArray(o)) { o.forEach((v) => walk(v, depth + 1)); return; }

          // BigBasket products: { desc, brand:{name}, pricing:{discount:{mrp, prim_price:{sp}}}, w }
          if (o.desc && o.pricing) {
            const pr = o.pricing.discount || {};
            const sp = pr.prim_price?.sp ?? o.pricing.prim_price?.sp;
            if (sp != null) {
              out.push({
                nativeId: o.id || o.sku || o.desc,
                name: [o.brand?.name, o.desc].filter(Boolean).join(' '),
                brand: o.brand?.name || null,
                unitText: o.w || o.magnitude || null,
                price: sp,
                mrp: pr.mrp ?? null,
                image: o.images?.[0]?.m || o.images?.[0]?.s || null,
                inStock: o.availability?.avail_status !== '0' && o.availability?.button !== 'Notify Me',
                url: o.absolute_url || (o.slug ? `https://www.bigbasket.com${o.slug}` : null),
                category: o.category?.tlc_name || null,
              });
            }
          }
          for (const k of Object.keys(o)) walk(o[k], depth + 1);
        };
        sources.forEach((s) => walk(s));

        if (out.length) return out;

        // DOM fallback.
        const money = (t) => {
          const m = (t || '').match(/₹\s*([\d,]+(?:\.\d+)?)/);
          return m ? parseFloat(m[1].replace(/,/g, '')) : null;
        };
        for (const card of document.querySelectorAll('li[class*="PaginateItems"], div[qa="product"]')) {
          const name = card.querySelector('h3, [class*="Description"]')?.textContent?.trim();
          if (!name) continue;
          const prices = [...new Set(
            [...card.querySelectorAll('*')].map((e) => money(e.textContent)).filter((n) => n != null)
          )].sort((a, b) => a - b);
          if (!prices.length) continue;
          out.push({
            nativeId: name, name,
            unitText: card.querySelector('[class*="PackSelector"], span[class*="Label"]')?.textContent?.trim() || null,
            price: prices[0],
            mrp: prices.length > 1 ? prices[prices.length - 1] : null,
            image: card.querySelector('img')?.src || null,
            inStock: !/out of stock|notify me/i.test(card.textContent || ''),
          });
        }
        return out;
      }, captured);

      const seen = new Set();
      return rows
        .filter((r) => { const k = String(r.nativeId); if (seen.has(k)) return false; seen.add(k); return true; })
        .map((r) => toOffer('bigbasket', r))
        .filter(Boolean);
    });
  },
};
