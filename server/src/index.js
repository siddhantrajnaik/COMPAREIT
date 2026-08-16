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

await app.register(cors, { origin: true, credentials: true });

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
