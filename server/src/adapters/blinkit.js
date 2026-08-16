import { withPage } from '../browser.js';
import { toOffer } from './base.js';
import { assertRendered } from './guard.js';

/**
 * Blinkit.
 *
 * Verified live: the search page server-renders results and leaves the whole
 * thing in a Redux store on `window.__reduxStore__`. Each result snippet carries
 * a `tracking.click_map` with brand, name, mrp, price and stock state already
 * separated — cleaner and far more stable than scraping the rendered DOM.
 * Location comes from the gr_1_lat / gr_1_lon cookies set in browser.js.
 */
export const blinkit = {
  id: 'blinkit',
  label: 'Blinkit',

  async search(query) {
    const url = `https://blinkit.com/s/?q=${encodeURIComponent(query)}`;

    return withPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Wait for the store to actually be populated, not just for the DOM.
      await page.waitForFunction(
        () => {
          const s = window.__reduxStore__?.getState?.();
          return !!s?.ui?.search?.searchProductBffData?.snippets?.length;
        },
        { timeout: 20000 }
      ).catch(() => {});
      await assertRendered(page, 'Blinkit');

      const rows = await page.evaluate(() => {
        const s = window.__reduxStore__?.getState?.();
        const snippets = s?.ui?.search?.searchProductBffData?.snippets || [];

        return snippets.map((sn) => {
          const t = sn.tracking?.click_map || sn.tracking?.impression_map || {};
          const c = sn.tracking?.common_attributes || {};
          const d = sn.data || {};
          const name = t.name || d.name?.text;
          if (!name) return null;

          const id = t.product_id || d.product_id || d.identity?.id;
          return {
            nativeId: id,
            name,
            brand: t.brand || c.brand || d.brand_name?.text || null,
            unitText: d.variant?.text || null,
            price: t.price ?? c.price ?? d.normal_price?.text,
            mrp: t.mrp ?? c.mrp ?? d.mrp?.text,
            image: d.image?.url || d.media_container?.items?.[0]?.image?.url || null,
            inStock: (t.state || c.state) !== 'sold_out' && d.is_sold_out !== true,
            eta: d.eta_tag?.title?.text || null,
            category: [t.l0_category, t.l1_category].filter((x) => x && !String(x).includes('NA')).join(' > ') || null,
            url: id ? `https://blinkit.com/prn/x/prid/${id}` : null,
            isAd: !!c.ads_campaign_id,
          };
        }).filter(Boolean);
      });

      return rows
        // Sponsored slots are ads, not honest price signal — drop them.
        .filter((r) => !r.isAd)
        .map((r) => toOffer('blinkit', r))
        .filter(Boolean);
    });
  },
};
