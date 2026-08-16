import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API = 'http://localhost:5177';

// Two builds from one source tree:
//   default        -> served by the local Node server at "/"
//   VITE_STATIC=1  -> GitHub Pages, served under /<repo>/ with no backend
const STATIC = process.env.VITE_STATIC === '1';
const BASE = process.env.VITE_BASE || (STATIC ? '/COMPAREIT/' : '/');

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      // injectManifest (not generateSW) because we need our own `push` and
      // `notificationclick` handlers — that's the whole point of the PWA here.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'QuickCompare — quick commerce price radar',
        short_name: 'QuickCompare',
        description: 'Compare Blinkit, Zepto, Instamart & BigBasket prices, track drops, catch food rescues.',
        theme_color: '#EFF0FB',
        background_color: '#F3F1FB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        categories: ['shopping', 'food', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,          // expose on LAN so you can install it from your phone
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
