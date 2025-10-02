/* PWA Service Worker */
const VERSION = 'v1-20251002';
const STATIC_CACHE = 'static-' + VERSION;
const DATA_CACHE   = 'data-' + VERSION;

const CORE_ASSETS = [
  './index.html',
  './styles.css',
  './main.js',
  './manifest.json',
  './offline.html',
  './pikachu_running.gif'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (!k.endsWith(VERSION)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// 小工具：網路請求加逾時
const networkWithTimeout = (req, ms = 3000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(timer); resolve(r); }, err => { clearTimeout(timer); reject(err); });
  });
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 導航請求：先網路，失敗用離線頁
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await networkWithTimeout(req, 4000);
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

  // 同站靜態：快取優先
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

  // Google Sheets：stale-while-revalidate（先回快取，背景更新）
  if (url.hostname.includes('docs.google.com')) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
        return r;
      }).catch(_ => null);
      // 先回快取，沒有快取就等網路
      return cached || networkPromise || Response.error();
    })());
    return;
  }
});
