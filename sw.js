// Service Worker - V1.11.1 (fix: no HTML fallback for dynamic data)
const SW_VERSION = 'V1.11.1';
const STATIC_CACHE = `static-${SW_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${SW_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/styles.css',
  '/pikachu_running.gif',
  '/manifest.webmanifest',
  '/offline.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![STATIC_CACHE, DYNAMIC_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
    const clientsArr = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of clientsArr){ c.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }); }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const isDynamicData = (url) => {
  const u = url.toString();
  return u.includes('docs.google.com/spreadsheets') || u.endsWith('.csv') || u.endsWith('.json');
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (isDynamicData(req.url)) {
    // Network-First for dynamic data, but DO NOT fall back to index.html on failure
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store', credentials: 'omit', mode: 'cors' });
        // Only cache if looks like CSV/JSON (avoid caching HTML error pages that break parsing)
        const ct = fresh.headers.get('content-type') || '';
        if (fresh.ok && (ct.includes('text/csv') || ct.includes('application/json'))) {
          const cache = await caches.open(DYNAMIC_CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Return a 503 to let app show proper error instead of silently parsing HTML
        return new Response('Dynamic data unavailable', { status: 503, statusText: 'Service Unavailable' });
      }
    })());
    return;
  }

  // Static assets: Stale-While-Revalidate
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(async (res) => {
      try { const cache = await caches.open(STATIC_CACHE); cache.put(req, res.clone()); } catch(e){}
      return res;
    }).catch(() => null);
    return cached || fetchPromise || fetch(req);
  })());
});
