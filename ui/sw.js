// Минимальный Service Worker для RuDeFi.
// Кэширует только статику (index.html, иконки, manifest).
// Не кэширует /api/* — всегда свежие данные с бэкенда.

const CACHE = 'rudefi-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
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
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API-запросы — всегда network, без кэша.
  if (url.pathname.startsWith('/api/')) {
    return;  // пропускаем, браузер сам сделает запрос
  }

  // Остальное — stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok && event.request.method === 'GET') {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
