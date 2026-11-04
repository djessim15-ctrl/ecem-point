/* ============================================================================
 * ECEM Point — service worker
 * ----------------------------------------------------------------------------
 * Garde en cache la « coquille » du site (pages, styles, scripts, polices) pour
 * un chargement instantané et un écran propre même hors ligne.
 *
 * Les requêtes vers Supabase (autre origine) ne sont JAMAIS mises en cache :
 * les points et le tchat restent toujours à jour.
 * ==========================================================================*/
const VERSION = 'ecem-point-v2.1.0';
const SHELL = [
  './',
  'index.html',
  'app.html',
  'assets/css/style.css',
  'assets/js/config.js',
  'assets/js/theme.js',
  'assets/js/icons.js',
  'assets/js/health.js',
  'assets/js/ui.js',
  'assets/js/fx.js',
  'assets/js/charts.js',
  'assets/js/insights.js',
  'assets/js/demo.js',
  'assets/js/db.js',
  'assets/js/data.js',
  'assets/js/app.js',
  'assets/js/auth.js',
  'assets/js/pwa.js',
  'assets/js/vendor/supabase.js',
  'assets/fonts/inter-latin-wght.woff2',
  'assets/fonts/inter-latin-ext-wght.woff2',
  'assets/fonts/jakarta-latin-wght.woff2',
  'assets/fonts/jakarta-latin-ext-wght.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigation : réseau d'abord, cache en secours. */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  /* Ressources : cache d'abord, puis mise à jour silencieuse. */
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
