// Caches the staff app shell and the current cycle's questions so the review
// works with no signal. Admin pages are never cached on the device.
const VERSION = 'hui360-v0.8';
const SHELL = [
  '/', '/review/', '/me/', '/mahalo/', '/privacy/', '/how/', '/tour/', '/tour/admin/', '/guide/',
  '/assets/style.css', '/assets/app.js', '/assets/idb.js', '/assets/home.js', '/assets/review.js', '/assets/me.js', '/assets/mahalo.js', '/assets/moon.js',
  '/assets/i18n/en.json', '/assets/i18n/haw.json',
  '/favicon.svg', '/assets/fonts/inter-latin.woff2', '/assets/fonts/inter-latin-ext.woff2',
];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(admin|api\/admin|m)\//.test(url.pathname) || url.pathname === '/sw.js') return;
  if (url.pathname.startsWith('/assets/fonts/')) return e.respondWith(cacheFirst(e.request));
  const api = url.pathname.startsWith('/api/');
  e.respondWith(networkFirst(e.request, api ? 6000 : 3000, !api));
});

// Fresh when the signal is good, cached when it is slow or gone.
async function networkFirst(req, wait, ignoreSearch) {
  const cache = await caches.open(VERSION);
  const net = fetch(req).then((res) => {
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), wait))]);
  } catch {
    return (await cache.match(req, { ignoreSearch })) || net.catch(() => new Response('{"error":"offline"}', { status: 503, headers: { 'content-type': 'application/json' } }));
  }
}

// Fonts never change: cache first.
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req)
    .then((res) => {
      if (res.ok && !res.redirected) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || new Response('Offline', { status: 503 });
}
