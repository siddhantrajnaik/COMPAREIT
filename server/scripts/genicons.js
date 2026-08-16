#!/usr/bin/env node
/**
 * Renders the PWA icon set from inline SVG using the Chromium that Playwright
 * already installed — avoids pulling in sharp/canvas just to make five PNGs.
 *
 * The mark: two price bars, the shorter one lit — "we found the cheaper one".
 * Reads clearly at 48px, which is the only size that really matters.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const OUT = path.join(ROOT, 'web', 'public');
fs.mkdirSync(OUT, { recursive: true });

const BG = '#14141F';
const ACCENT = '#8B7BFF';   // lavender — matches the app's primary
const DIM = '#3D3D5C';

/** @param {number} s size @param {number} pad inset ratio for maskable safe-area */
const svg = (s, pad = 0, bg = BG) => {
  const k = s / 100;                       // design grid is 100x100
  const inset = pad * s;
  const g = (v) => (inset + v * k * (1 - 2 * pad)).toFixed(2);
  const w = (v) => (v * k * (1 - 2 * pad)).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${pad ? 0 : s * 0.22}" fill="${bg}"/>
    <rect x="${g(22)}" y="${g(26)}" width="${w(15)}" height="${w(48)}" rx="${w(3.5)}" fill="${DIM}"/>
    <rect x="${g(43)}" y="${g(44)}" width="${w(15)}" height="${w(30)}" rx="${w(3.5)}" fill="${ACCENT}"/>
    <rect x="${g(64)}" y="${g(34)}" width="${w(15)}" height="${w(40)}" rx="${w(3.5)}" fill="${DIM}"/>
    <path d="M ${g(50.5)} ${g(20)} l ${w(6)} ${w(9)} h ${w(-12)} z" fill="${ACCENT}"/>
  </svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage();

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Maskable icons get cropped to a circle by Android — keep art inside 80%.
  { file: 'icon-maskable.png', size: 512, pad: 0.12 },
  { file: 'badge.png', size: 96, pad: 0, bg: 'transparent' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
];

for (const t of targets) {
  const markup = svg(t.size, t.pad, t.bg || BG);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<body style="margin:0;background:transparent">${markup}</body>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({
    path: path.join(OUT, t.file),
    omitBackground: t.bg === 'transparent',
  });
  console.log('wrote', t.file);
}

fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(100, 0));
console.log('wrote icon.svg');

await browser.close();
