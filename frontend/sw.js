// Минимальный Service Worker для RuDeFi.
// Кэширует только статику (index.html, иконки, manifest).
// Не кэширует /api/* — всегда свежие данные с бэкенда.

const CACHE = 'rudefi-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles/base.css',
  '/styles/app.css',
  '/about.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((e) => console.warn('[sw] install cache failed', e))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('rudefi-') && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Cache only this application's static GET resources. External APIs and
  // wallet/RPC traffic must never enter the offline cache.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !STATIC_ASSETS.includes(url.pathname)) return;

  // Network first: a deployment is visible on the next navigation.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
