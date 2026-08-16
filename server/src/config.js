import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readEnvFile() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readEnvFile(), ...process.env };

export const config = {
  port: Number(env.PORT || 5177),
  host: env.HOST || '0.0.0.0',

  // Where you are. Everything (which dark store serves you, what prices you see)
  // depends on this. Editable live from the app's Settings screen.
  //
  // Two forms are needed, not one: Blinkit and Zepto resolve a dark store from
  // lat/lon, while Flipkart, JioMart and DMart return nothing at all without a
  // delivery pincode.
  location: {
    lat: Number(env.LAT || 12.9716),
    lon: Number(env.LON || 77.5946),
    locality: env.LOCALITY || 'Bengaluru',
    pincode: env.PINCODE || '560001',
  },

  // Headless is faster; headful survives bot-detection better on stubborn sites.
  headless: env.HEADLESS ? env.HEADLESS !== 'false' : true,

  // How often the watchlist poller wakes up (ms). Each cycle re-prices every
  // tracked item on every enabled platform.
  pollIntervalMs: Number(env.POLL_INTERVAL_MS || 15 * 60 * 1000),

  // Politeness: never hammer. Delay between individual platform page loads.
  scrapeDelayMs: Number(env.SCRAPE_DELAY_MS || 1500),

  // Cached search results are reused for this long before re-scraping.
  searchCacheMs: Number(env.SEARCH_CACHE_MS || 5 * 60 * 1000),

  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:you@example.com',
  },

  rescue: {
    enabled: env.RESCUE_ENABLED === 'true',
    intervalMs: Number(env.RESCUE_INTERVAL_MS || 60 * 1000),
  },

  // JioMart is off by default — it gates hard on pincode and its search page
  // resists automation, so it fails more often than it works. Enable it in
  // .env if it behaves on your connection.
  platforms: (env.PLATFORMS || 'blinkit,zepto,instamart,bigbasket,dmart,flipkart')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

export function saveLocation({ lat, lon, locality, pincode }) {
  config.location = {
    lat, lon,
    locality: locality || config.location.locality,
    pincode: pincode || config.location.pincode,
  };
  const p = path.join(DATA_DIR, 'location.json');
  fs.writeFileSync(p, JSON.stringify(config.location, null, 2));
}

// Restore a previously saved location on boot.
try {
  const p = path.join(DATA_DIR, 'location.json');
  if (fs.existsSync(p)) Object.assign(config.location, JSON.parse(fs.readFileSync(p, 'utf8')));
} catch { /* keep defaults */ }
