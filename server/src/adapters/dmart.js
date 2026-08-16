import { withPage } from '../browser.js';
import { toOffer } from './base.js';
import { assertRendered } from './guard.js';

/**
 * DMart Ready.
 *
 * Verified live. DMart is the most generous of the lot: the card carries the
 * pack size, the MRP and its own price as plainly labelled text —
 *
 *   "Amul Butter : 500 g  MRP ₹ 310  DMart ₹ 300  ₹ 10 OFF  500 g (₹ 0.60 / 1 g)"
 *
 * Class names are Tailwind-generated and churn, so we anchor on the product
 * link, climb to the nearest ancestor that actually contains a price, and read
 * the labels out of the text. Labels outlive class hashes.
 *
 * DMart is slot-based rather than 10-minute delivery, and needs a pincode set
 * for accurate stock — see browser.js for how the pincode is applied.
 */
export const dmart = {
  id: 'dmart',
  label: 'DMart',

  async search(query) {
    const url = `https://www.dmart.in/search?searchTerm=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href*="/product/"]', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await assertRendered(page, 'DMart');

      const rows = await page.evaluate(() => {
        const seen = new Set();
        const out = [];

        for (const a of document.querySelectorAll('a[href*="/product/"]')) {
          // Climb to the smallest ancestor that includes a rupee figure.
          let card = a;
          for (let i = 0; i < 7 && card.parentElement; i++) {
            card = card.parentElement;
            if (/₹/.test(card.innerText || '')) break;
          }
          const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
          if (!/₹/.test(text)) continue;

          const href = a.getAttribute('href') || '';
          const id = href.match(/selectedProd=(\d+)/)?.[1] || href;
          if (seen.has(id)) continue;

          // img alt is authoritative and carries the pack size: "Amul Butter : 500 g"
          const alt = a.querySelector('img')?.getAttribute('alt')
            || card.querySelector('img[alt]')?.getAttribute('alt') || '';
          const [rawName, rawSize] = alt.split(/\s+:\s+/);

          const num = (re) => {
            const m = text.match(re);
            return m ? parseFloat(m[1].replace(/,/g, '')) : null;
          };
          const price = num(/DMart\s*₹\s*([\d,]+(?:\.\d+)?)/i);
          const mrp = num(/MRP\s*₹\s*([\d,]+(?:\.\d+)?)/i);
          if (price == null) continue;

          seen.add(id);
          out.push({
            nativeId: id,
            name: (rawName || text.split('MRP')[0] || '').trim(),
            brand: (rawName || '').trim().split(/\s+/)[0] || null,
            unitText: (rawSize || '').trim() || null,
            price,
            mrp,
            // DMart marks unavailability on the button, not the price.
            inStock: !/out of stock|notify me|sold out/i.test(text),
            url: href ? new URL(href, 'https://www.dmart.in').href : null,
            image: null,   // images are blocked at the network layer for speed
          });
        }
        return out;
      });

      return rows.map((r) => toOffer('dmart', r)).filter((o) => o && o.name);
    });
  },
};
