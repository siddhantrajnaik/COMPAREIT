import { withPage } from '../browser.js';
import { toOffer } from './base.js';
import { assertRendered } from './guard.js';

/**
 * JioMart — BEST EFFORT, DISABLED BY DEFAULT.
 *
 * Being straight about this one: I could not get JioMart to return products
 * from my test environment. It refuses to show any catalogue until a delivery
 * pincode is accepted, its /search URLs answered "We couldn't find the page",
 * and its own search box did not respond to automation within 60s.
 *
 * So this adapter is written from its documented URL shape and generic card
 * heuristics rather than a verified DOM, and it is NOT in the default platform
 * list. Add `jiomart` to PLATFORMS in .env if you want to try it; check
 * Settings → Diagnostics to see whether it actually returns anything for you.
 *
 * If it works on your connection, the fix is usually the pincode — set yours in
 * Settings first.
 */
export const jiomart = {
  id: 'jiomart',
  label: 'JioMart',

  async search(query) {
    const url = `https://www.jiomart.com/search/${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await assertRendered(page, 'JioMart');

      const rows = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        const money = (t) => {
          const m = (t || '').match(/₹\s*([\d,]+(?:\.\d+)?)/);
          return m ? parseFloat(m[1].replace(/,/g, '')) : null;
        };

        const cards = document.querySelectorAll(
          '[class*="product-card"], li[class*="product"], a[href*="/p/"]'
        );
        for (const card of cards) {
          const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
          if (!/₹/.test(text)) continue;

          const name = card.querySelector('[class*="name"], [class*="title"], h3, h4')?.textContent?.trim()
            || card.querySelector('img[alt]')?.getAttribute('alt')?.trim();
          if (!name || name.length < 3) continue;

          const href = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
          const id = href || name;
          if (seen.has(id)) continue;

          const prices = [...new Set(
            [...card.querySelectorAll('*')].map((e) => money(e.textContent)).filter((n) => n != null)
          )].sort((a, b) => a - b);
          if (!prices.length) continue;

          seen.add(id);
          out.push({
            nativeId: href.split('/').pop() || name,
            name,
            brand: name.split(/\s+/)[0],
            unitText: (text.match(/(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|ltr|gm|pcs)\b)/i) || [])[1] || null,
            price: prices[0],
            mrp: prices.length > 1 ? prices[prices.length - 1] : null,
            inStock: !/out of stock|sold out|notify/i.test(text),
            url: href ? new URL(href, 'https://www.jiomart.com').href : null,
            image: null,
          });
        }
        return out;
      });

      return rows.map((r) => toOffer('jiomart', r)).filter(Boolean);
    });
  },
};
