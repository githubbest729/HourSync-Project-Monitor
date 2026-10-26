/* HourSync service worker — offline-first, versioned */
const VERSION = 'hoursync-v2.0.0';
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
  event.waitUntil(caches.open(PRECACHE).then(c => c.addAll(ASSETS)));  // waits; app shows an update banner
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hoursync-') && !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  const t = e.data && e.data.type ? e.data.type : e.data;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  if (t === 'GET_VERSION' && e.source) e.source.postMessage({ version: VERSION });
});

// Background sync: when connectivity returns, ask open windows to re-check SLA/budget alerts and the app badge
self.addEventListener('sync', event => {
  if (event.tag === 'sync-hoursync-queue') {
    event.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ type: 'SYNC' }))));
  }
});

// Push (needs a push server to send; handler shows the payload if one is ever configured)
self.addEventListener('push', event => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'HourSync', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-96.png', data: { url: d.url || './index.html#blockers' } }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html#blockers';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.postMessage({ type: 'NAVIGATE', view: (url.split('#')[1] || 'dashboard') }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

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
