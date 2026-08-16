#!/usr/bin/env node
/**
 * Serves web/dist under a base path, imitating GitHub Pages locally.
 * Lets you check the static build before pushing, including the /<repo>/
 * prefix and the 404.html SPA fallback.
 *
 *   node server/scripts/serve-static.js [basePath] [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const BASE = (process.argv[2] || '/COMPAREIT/').replace(/\/*$/, '/');
const PORT = Number(process.argv[3] || 5178);
const DIST = path.join(ROOT, 'web', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (p === '/' || p === BASE.slice(0, -1)) {
    res.writeHead(302, { Location: BASE }); return res.end();
  }
  if (!p.startsWith(BASE)) { res.writeHead(404); return res.end('outside base path'); }

  let rel = p.slice(BASE.length) || 'index.html';
  let file = path.join(DIST, rel);

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');       // SPA fallback, as Pages does
  }

  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}).listen(PORT, () => {
  console.log(`Static preview: http://localhost:${PORT}${BASE}`);
});
