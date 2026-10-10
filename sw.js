/* SintergiaSE offline shell. Never cache API/auth/sync responses. */
'use strict';
const CACHE_PREFIX = 'sintergiase-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v2';
const SCOPE_URL = self.registration.scope;
const APP_SHELL = new URL('./index.html', SCOPE_URL).href;
const OPTIONAL_ASSETS = [
  new URL('./manifest.webmanifest', SCOPE_URL).href
];
function isBackend(url, request) {
  if (url.origin !== self.location.origin) return true;
  if (request && request.headers && request.headers.has('authorization')) return true;
  return /\/functions\/v1\/|\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\/realtime\/v1\//i.test(url.pathname)
    || /[?&](token|access_token|apikey)=/i.test(url.search);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // The HTML shell is required; optional PWA assets must not block installation.
    await cache.add(new Request(APP_SHELL, { cache: 'reload' }));
    await Promise.all(OPTIONAL_ASSETS.map(async url => {
      try { const r = await fetch(new Request(url, { cache: 'reload' })); if (r.ok) await cache.put(url, r); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never synthesize/cache authentication, database, storage, realtime, or edge-function replies.
  if (isBackend(url, request)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        // Only refresh the cached shell from the canonical index URL; never let an
        // unrelated in-scope navigation (e.g. a deep link or login route) overwrite it.
        const requested = new URL(request.url);
        const canonical = new URL(APP_SHELL);
        if (requested.origin === canonical.origin && requested.pathname === canonical.pathname
            && response && response.ok && response.type !== 'opaque'
            && /text\/html/i.test(response.headers.get('content-type') || '')) {
          await cache.put(APP_SHELL, response.clone());
        }
        return response;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match(APP_SHELL)) || new Response('SintergiaSE no está disponible sin conexión. Abre la aplicación al menos una vez con Internet y vuelve a intentarlo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }
  // Cache only same-origin static assets; API calls and all cross-origin requests bypass this worker.
  if (url.origin === self.location.origin && ['script','style','image','font','manifest'].includes(request.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const refresh = fetch(request).then(response => {
        if (response && response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => null);
      return cached || (await refresh) || Response.error();
    })());
  }
});
