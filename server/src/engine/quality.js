/**
 * Is a scrape run trustworthy enough to publish?
 *
 * Extracted from the scheduled scraper so it can be tested directly. The
 * distinction it draws is subtle and easy to get backwards:
 *
 *   - quick-commerce platforms enabled but all returned nothing  -> degraded
 *   - quick-commerce platforms not enabled at all                -> fine
 *
 * The first is a failure (almost always: the machine is outside India, where
 * Blinkit/Zepto/DMart serve an empty catalogue). The second is a deliberate
 * configuration choice and must not be treated as broken.
 */

export const QUICK_COMMERCE = ['blinkit', 'zepto', 'instamart', 'dmart', 'bigbasket'];

export const DEGRADED_REASON =
  'No quick-commerce platform returned products. The machine running this scrape is most ' +
  'likely outside India, where Blinkit, Zepto and DMart do not serve results. Prices shown ' +
  'here are incomplete and should not be trusted for comparison.';

/**
 * @param {Map<string, {offers:number}>|Record<string,{offers:number}>} stats
 * @param {string[]} enabledPlatforms
 */
export function assessRun(stats, enabledPlatforms) {
  const get = (id) => (stats instanceof Map ? stats.get(id) : stats[id]);

  const enabled = QUICK_COMMERCE.filter((id) => enabledPlatforms.includes(id));
  const offers = enabled.reduce((n, id) => n + (get(id)?.offers || 0), 0);

  const degraded = enabled.length > 0 && offers === 0;
  return {
    degraded,
    quickCommerceEnabled: enabled,
    quickCommerceOffers: offers,
    reason: degraded ? DEGRADED_REASON : null,
  };
}
