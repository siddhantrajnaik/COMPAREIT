import { withPage } from '../browser.js';
import { toOffer } from './base.js';
import { assertRendered } from './guard.js';

/**
 * Zepto.
 *
 * Verified live against the current site. Two things worth knowing:
 *
 *  1. zeptonow.com now redirects to zepto.com. We request the old host and let
 *     the redirect happen, so this keeps working either way.
 *  2. There is no usable JSON island — `__next_f` comes back empty — but the
 *     rendered cards are unusually well-labelled: every field sits behind a
 *     stable `data-slot-id`, which is far more durable than the hashed class
 *     names around them. So we read slots, not classes.
 *
 * Card shape:
 *   a[data-testid="product-card"]  href="/pn/<slug>/pvid/<uuid>"
 *     [data-is-out-of-stock="false"]
 *     [data-slot-id="EdlpPrice"]    -> span(price), span(mrp)
 *     [data-slot-id="ProductName"]
 *     [data-slot-id="PackSize"]     -> "1 pack (100 g)"
 *     [data-slot-id="SponsorTag"]   -> present only on ads
 */
export const zepto = {
  id: 'zepto',
  label: 'Zepto',

  async search(query) {
    const url = `https://www.zeptonow.com/search?query=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[data-testid="product-card"]', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      await assertRendered(page, 'Zepto');

      const rows = await page.evaluate(() => {
        const money = (el) => {
          const m = (el?.textContent || '').match(/₹\s*([\d,]+(?:\.\d+)?)/);
          return m ? parseFloat(m[1].replace(/,/g, '')) : null;
        };

        return [...document.querySelectorAll('a[data-testid="product-card"]')].map((card) => {
          const slot = (id) => card.querySelector(`[data-slot-id="${id}"]`);

          const name = slot('ProductName')?.textContent?.trim()
            || card.querySelector('img[alt]')?.getAttribute('alt')?.trim();
          if (!name) return null;

          // EdlpPrice holds the live price first, struck-through MRP second.
          const priceSpans = [...(slot('EdlpPrice')?.querySelectorAll('span') || [])]
            .map(money).filter((n) => n != null);
          if (!priceSpans.length) return null;

          const href = card.getAttribute('href') || '';
          const pvid = href.match(/\/pvid\/([\w-]+)/)?.[1];
          const img = card.querySelector('img')?.getAttribute('src') || '';

          return {
            nativeId: pvid || href || name,
            name,
            brand: name.split(/\s+/)[0],          // Zepto doesn't expose brand separately
            unitText: slot('PackSize')?.textContent?.trim() || null,
            price: Math.min(...priceSpans),
            mrp: priceSpans.length > 1 ? Math.max(...priceSpans) : null,
            // Images are blocked at the network layer for speed, so the src is
            // often still the placeholder — don't pass that off as a photo.
            image: img && !/defaultPlaceholder/i.test(img) ? img : null,
            inStock: card.querySelector('[data-is-out-of-stock]')?.getAttribute('data-is-out-of-stock') !== 'true',
            url: href ? new URL(href, location.origin).href : null,
            isAd: !!slot('SponsorTag'),
          };
        }).filter(Boolean);
      });

      return rows
        .filter((r) => !r.isAd)          // sponsored slots aren't price signal
        .map((r) => toOffer('zepto', r))
        .filter(Boolean);
    });
  },
};
