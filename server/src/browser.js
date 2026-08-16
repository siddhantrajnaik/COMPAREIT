import { chromium } from 'playwright';
import { config, PROFILE_DIR } from './config.js';

/**
 * One long-lived Chromium with a persistent profile.
 *
 * Persistence matters more than it looks: cookies set once (location, and for
 * Zomato your login) survive restarts, and a profile with real history trips
 * far fewer bot heuristics than a cold incognito context on every request.
 */

let ctxPromise = null;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function getContext() {
  if (!ctxPromise) {
    ctxPromise = chromium.launchPersistentContext(PROFILE_DIR, {
      headless: config.headless,
      viewport: { width: 1366, height: 900 },
      userAgent: UA,
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      geolocation: { latitude: config.location.lat, longitude: config.location.lon },
      permissions: ['geolocation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    }).then(async (ctx) => {
      // navigator.webdriver is the single most-checked automation tell.
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      });
      // Images/fonts/media are pure cost for a scraper — block them.
      await ctx.route('**/*', (route) => {
        const t = route.request().resourceType();
        if (t === 'image' || t === 'media' || t === 'font') return route.abort();
        return route.continue();
      });
      return ctx;
    });
  }
  return ctxPromise;
}

export async function setLocationCookies() {
  const ctx = await getContext();
  const { lat, lon, locality, pincode } = config.location;
  const deviceId = 'qc-' + Math.random().toString(36).slice(2, 14);

  await ctx.addCookies([
    // Blinkit reads location straight off these — no UI interaction needed.
    { name: 'gr_1_lat', value: String(lat), domain: '.blinkit.com', path: '/' },
    { name: 'gr_1_lon', value: String(lon), domain: '.blinkit.com', path: '/' },
    { name: 'gr_1_locality', value: locality, domain: '.blinkit.com', path: '/' },
    { name: 'gr_1_landmark', value: locality, domain: '.blinkit.com', path: '/' },
    { name: 'gr_1_deviceId', value: deviceId, domain: '.blinkit.com', path: '/' },
    // Swiggy stores the chosen delivery point as a JSON blob.
    {
      name: 'userLocation',
      value: encodeURIComponent(JSON.stringify({ lat, lng: lon, address: locality, id: '' })),
      domain: '.swiggy.com', path: '/',
    },
    // Pincode-gated platforms. These three show nothing at all — not an empty
    // result, literally no catalogue — until a delivery pincode is set.
    ...(pincode ? [
      { name: 'pincode', value: String(pincode), domain: '.flipkart.com', path: '/' },
      { name: 'nms_mgo_pincode', value: String(pincode), domain: '.jiomart.com', path: '/' },
      { name: 'pin', value: String(pincode), domain: '.dmart.in', path: '/' },
      { name: 'pincode', value: String(pincode), domain: '.dmart.in', path: '/' },
    ] : []),
  ]).catch(() => { /* cookie domain rejections are non-fatal */ });

  // Several of these read the pincode from storage rather than a cookie, so
  // seed localStorage on their origins too. Best-effort: a failed seed just
  // means that platform falls back to asking, which we detect as "blocked".
  if (pincode) {
    for (const origin of ['https://www.dmart.in', 'https://www.jiomart.com']) {
      await ctx.addInitScript(({ o, p }) => {
        if (location.origin !== o) return;
        try {
          localStorage.setItem('pin', p);
          localStorage.setItem('pincode', p);
          localStorage.setItem('deliveryPincode', p);
        } catch { /* storage disabled */ }
      }, { o: origin, p: String(pincode) }).catch(() => {});
    }
  }

  await ctx.setGeolocation({ latitude: lat, longitude: lon });
}

export async function withPage(fn, { timeout = 45000 } = {}) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!ctxPromise) return;
  const ctx = await ctxPromise.catch(() => null);
  ctxPromise = null;
  if (ctx) await ctx.close().catch(() => {});
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
