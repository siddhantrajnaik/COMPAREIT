#!/usr/bin/env node
/**
 * Opens a real, visible browser against the app's persistent profile so you can
 * sign in to Zomato (and set your delivery address on any platform) by hand.
 *
 * Nothing about your credentials touches this codebase — you type them into
 * Zomato's own page, and only the resulting session cookie is stored locally in
 * data/browser-profile, on your machine.
 *
 * Usage:  npm run login          (defaults to Zomato)
 *         npm run login -- blinkit
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const PROFILE = path.join(ROOT, 'data', 'browser-profile');

const TARGETS = {
  zomato: 'https://www.zomato.com/',
  blinkit: 'https://blinkit.com/',
  zepto: 'https://www.zeptonow.com/',
  instamart: 'https://www.swiggy.com/instamart',
  bigbasket: 'https://www.bigbasket.com/',
};

const which = (process.argv[2] || 'zomato').toLowerCase();
const url = TARGETS[which] || TARGETS.zomato;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
  args: ['--disable-blink-features=AutomationControlled'],
});

await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(url);

console.log(`
  A browser window is open at ${url}

  1. Log in and/or set your delivery address exactly as you want it.
  2. Come back here and press Enter to save the session.

  The session is stored only in data/browser-profile on this machine.
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => rl.question('Press Enter when done... ', resolve));
rl.close();

await ctx.close();
console.log('Session saved.');
