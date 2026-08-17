import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, ROOT } from './config.js';
import { registerRoutes } from './routes.js';
import { setLocationCookies, closeBrowser } from './browser.js';
import { startPoller, stopPoller } from './engine/poller.js';
import { startRescue, stopRescue } from './engine/rescue.js';
import './db.js';

const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

/**
 * CORS is deliberately narrow.
 *
 * `origin: true` reflects whatever Origin the caller sends, which combined with
 * `credentials: true` means any website you happen to visit could call this API
 * and read your location, watchlist and price history — the server listens on
 * 0.0.0.0 so your phone can reach it, which also puts it on the LAN.
 *
 * In production the UI is served from this same origin, so no CORS is needed at
 * all. Only the Vite dev server on :5173 is genuinely cross-origin.
 */
const DEV_ORIGINS = [/^http:\/\/localhost:5173$/, /^http:\/\/127\.0\.0\.1:5173$/,
                     /^http:\/\/\[?[\da-fA-F:.]+]?:5173$/];   // LAN IP during dev

await app.register(cors, {
  origin(origin, cb) {
    // Same-origin and non-browser callers send no Origin header.
    if (!origin) return cb(null, true);
    cb(null, DEV_ORIGINS.some((re) => re.test(origin)));
  },
  credentials: true,
});

// Minimal httpErrors shim so routes can throw structured errors without
// pulling in another dependency.
app.decorate('httpErrors', {
  badRequest: (m) => Object.assign(new Error(m || 'Bad Request'), { statusCode: 400 }),
  notFound: (m) => Object.assign(new Error(m || 'Not Found'), { statusCode: 404 }),
});

app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode || 500;
  if (code >= 500) console.error('[api]', req.method, req.url, err);
  reply.code(code).send({ error: err.message || 'Internal error' });
});

registerRoutes(app);

// Serve the built PWA when it exists, so `npm start` gives you the whole app
// on one port — which is also what makes it installable over LAN from a phone.
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');   // SPA fallback
  });
} else {
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
    reply.code(200).type('text/html').send(
      `<h1>QuickCompare API is running</h1>
       <p>The web UI isn't built yet. Run <code>npm run dev</code> for the dev server,
       or <code>npm run build</code> then <code>npm start</code>.</p>`
    );
  });
}

function lanAddress() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return 'localhost';
}

await app.listen({ port: config.port, host: config.host });

console.log(`
  QuickCompare
  ------------------------------------------------
  Local     http://localhost:${config.port}
  Network   http://${lanAddress()}:${config.port}   <- open this on your phone
  Location  ${config.location.locality} (${config.location.lat}, ${config.location.lon})
  Platforms ${config.platforms.join(', ')}
  Push      ${config.vapid.publicKey ? 'enabled' : 'DISABLED - run `npm run keys`'}
`);

// Warm the browser + location cookies in the background so the first search
// isn't paying for a cold Chromium launch.
setLocationCookies().catch((e) => console.warn('[browser] warmup failed:', e.message));

startPoller();
if (config.rescue.enabled) startRescue();

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    console.log('\nShutting down...');
    stopPoller();
    stopRescue();
    await closeBrowser();
    await app.close();
    process.exit(0);
  });
}
