/* HourSync service worker — offline-first, versioned */
const VERSION = 'hoursync-v1.0.0';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;
const ASSETS = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest',
  'css/styles.css', 'js/db.js', 'js/charts.js', 'js/app.js',
  'favicon.ico', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png',
  'assets/al-gurg-badge.svg',
  'icons/icon-72.png', 'icons/icon-96.png', 'icons/icon-128.png', 'icons/icon-144.png', 'icons/icon-152.png',
  'icons/icon-192.png', 'icons/icon-384.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
  'screenshots/screenshot-wide.png', 'screenshots/screenshot-narrow.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(PRECACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hoursync-') && !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); if (e.data === 'GET_VERSION' && e.source) e.source.postMessage({ version: VERSION }); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigation: network-first with cached shell, then offline page
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME); cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || (await caches.match('offline.html'));
      }
    })());
    return;
  }

  // Assets: stale-while-revalidate
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok) caches.open(RUNTIME).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    return res || (req.destination === 'document' ? caches.match('offline.html') : new Response('', { status: 504, statusText: 'Offline' }));
  })());
});
