// Service Worker - V1.10
const SW_VERSION = 'V1.10';
const STATIC_CACHE = `static-${SW_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${SW_VERSION}`;

// Adjust these paths to your deployment root if needed (e.g., '/PKGO-MEGA-Web/')
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/styles.css',
  '/pikachu_running.gif',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => ![STATIC_CACHE, DYNAMIC_CACHE].includes(k))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const isDynamicData = (url) => {
  return url.includes('docs.google.com/spreadsheets') || url.endsWith('.csv') || url.endsWith('.json');
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (isDynamicData(req.url)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match('/index.html');
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(async (res) => {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || fetchPromise || fetch(req);
  })());
});
