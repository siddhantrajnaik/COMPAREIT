import { withPage } from '../browser.js';
import { toOffer } from './base.js';
import { assertRendered } from './guard.js';

/**
 * Flipkart (including Flipkart Minutes stock where your pincode is served).
 *
 * Verified live on the marketplace search: ~77 product tiles with prices and
 * availability. One caveat worth stating plainly — Flipkart Minutes, the
 * 10-minute service, only surfaces once a serviceable pincode is set, and it
 * has no separate public URL. So this adapter returns Flipkart catalogue prices
 * generally; whether a given item is *Minutes*-eligible depends on your pincode
 * and isn't reliably exposed on the search page.
 *
 * Flipkart's class names are obfuscated and rotate, so nothing here depends on
 * them: we anchor on product links (/p/<itemid>), climb to the priced ancestor,
 * and recover the name from the URL slug, which is stable.
 *
 * Two verified behaviours worth knowing:
 *
 *  - Without a serviceable pincode, Flipkart still shows prices but stamps
 *    every tile "Currently unavailable". If everything here comes back out of
 *    stock, that's the pincode, not a parsing failure — set yours in Settings.
 *  - Its search tiles don't carry pack size, so most Flipkart offers have no
 *    price-per-unit. We leave it null rather than guessing a size, which would
 *    poison the ₹/unit comparison that the rest of the app depends on.
 */
export const flipkart = {
  id: 'flipkart',
  label: 'Flipkart',

  async search(query) {
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href*="/p/"]', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await assertRendered(page, 'Flipkart');

      const rows = await page.evaluate(() => {
        const seen = new Set();
        const out = [];

        // Turn "amul-pasteurised-salted-butter" into "Amul Pasteurised Salted Butter".
        const fromSlug = (href) => {
          const slug = (href.split('/p/')[0] || '').split('/').filter(Boolean).pop() || '';
          return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
        };

        for (const a of document.querySelectorAll('a[href*="/p/"]')) {
          const href = a.getAttribute('href') || '';
          const pid = href.match(/pid=([A-Z0-9]+)/)?.[1]
            || href.match(/\/p\/(itm[a-z0-9]+)/)?.[1];
          if (!pid || seen.has(pid)) continue;

          let card = a;
          for (let i = 0; i < 6 && card.parentElement; i++) {
            card = card.parentElement;
            if (/₹/.test(card.innerText || '')) break;
          }
          const text = (card.innerText || '').replace(/\s+/g, ' ').trim();

          const prices = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)]
            .map((m) => parseFloat(m[1].replace(/,/g, '')))
            .filter((n) => Number.isFinite(n) && n > 0);
          if (!prices.length) continue;

          // Skip the sidebar price-filter tiles, which are round numbers with
          // no product link text and would otherwise pose as ₹200 products.
          const name = (a.getAttribute('title') || '').trim() || fromSlug(href);
          if (!name || name.length < 3) continue;

          seen.add(pid);
          const sorted = [...new Set(prices)].sort((x, y) => x - y);
          out.push({
            nativeId: pid,
            name,
            brand: name.split(/\s+/)[0],
            // Flipkart puts pack size inside the name rather than a field.
            unitText: (name.match(/(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|ltr|gm|pcs|pack)\b)/i) || [])[1] || null,
            price: sorted[0],
            mrp: sorted.length > 1 ? sorted[sorted.length - 1] : null,
            inStock: !/currently unavailable|out of stock|sold out|coming soon/i.test(text),
            url: href ? new URL(href, 'https://www.flipkart.com').href : null,
            image: null,
          });
        }
        return out;
      });

      return rows.map((r) => toOffer('flipkart', r)).filter(Boolean);
    });
  },
};
