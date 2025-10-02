const VERSION = 'v1-20251006';
const STATIC_CACHE = 'static-' + VERSION;
const DATA_CACHE   = 'data-' + VERSION;

const CORE_ASSETS = [
  './index.html',
  './styles.css?v=20251005',
  './main.js?v=20251005',
  './manifest.json',
  './offline.html',
  './pikachu_running.gif?v=20251005',
  './icons/apple-touch-icon-180.png?v=20251005',
  './icons/icon-192.png?v=20251005',
  './icons/icon-512.png?v=20251005',
  './icons/favicon-32.png?v=20251005'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (!k.endsWith(VERSION)) return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        const cache = await caches.open(STATIC_CACHE);
        const offline = await cache.match('./offline.html');
        return offline || Response.error();
      }
    })());
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return cached || Response.error();
      }
    })());
    return;
  }

  if (url.hostname.includes('docs.google.com')) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
        return r;
      }).catch(_ => null);
      return cached || networkPromise || Response.error();
    })());
    return;
  }
});
