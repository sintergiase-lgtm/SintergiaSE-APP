/* SintergiaSE offline shell + restricted offline authorization guard. */
'use strict';
const CACHE_PREFIX = 'sintergiase-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v4';
const SCOPE_URL = self.registration.scope;
const APP_SHELL = new URL('./index.html', SCOPE_URL).href;
const SCOPE_PATH = new URL(SCOPE_URL).pathname;
const OPTIONAL_ASSETS = [new URL('./manifest.webmanifest', SCOPE_URL).href, new URL('./offline-guard.js', SCOPE_URL).href, new URL('./icon-192.png', SCOPE_URL).href, new URL('./icon-512.png', SCOPE_URL).href];
const NAV_TIMEOUT_MS = 4000;

/* Inject the guard as the first script in <head>, before app scripts and before
   synchronization starts. The separate same-origin file is cached for offline use. */
const GUARD_TAG = '<script id="sintergia-offline-auth-guard" src="./offline-guard.js"><\/script>';

function isBackend(url, request) {
  if (url.origin !== self.location.origin) return true;
  if (request && request.headers && request.headers.has('authorization')) return true;
  return /\/functions\/v1\/|\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\/realtime\/v1\//i.test(url.pathname)
    || /[?&](token|access_token|apikey)=/i.test(url.search);
}
function isAppDocument(url) {
  return url.origin === self.location.origin && (url.pathname === new URL(APP_SHELL).pathname || url.pathname === SCOPE_PATH);
}
async function withOfflineGuard(response) {
  if (!response || !response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) return response;
  const html = await response.clone().text();
  if (html.includes('id="sintergia-offline-auth-guard"')) return response;
  const headPattern = /<head(?:\s[^>]*)?>/i;
  if (!headPattern.test(html)) return response;
  const guardedHtml = html.replace(headPattern, match => match + GUARD_TAG);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(guardedHtml, {status: response.status, statusText: response.statusText, headers});
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
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
  // Never cache or replace API/auth/sync responses, including cross-origin backend traffic.
  if (isBackend(url, request)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        /* With a cached shell, don't hang on a connection that reports online but
           doesn't respond: fall back to the cache after NAV_TIMEOUT_MS. */
        const hasShell = await cache.match(APP_SHELL);
        const response = hasShell
          ? await Promise.race([fetch(request), new Promise((_, rej) => setTimeout(() => rej(new Error('nav-timeout')), NAV_TIMEOUT_MS))])
          : await fetch(request);
        if (isAppDocument(url)) {
          const guarded = await withOfflineGuard(response);
          if (guarded && guarded.ok && /text\/html/i.test(guarded.headers.get('content-type') || '')) {
            await cache.put(APP_SHELL, guarded.clone());
            return guarded;
          }
        }
        return response;
      } catch (_) {
        const cached = (await cache.match(request)) || (await cache.match(APP_SHELL));
        if (cached) {
          const guarded = await withOfflineGuard(cached);
          if (guarded !== cached) await cache.put(APP_SHELL, guarded.clone()).catch(() => {});
          return guarded;
        }
        return new Response('SintergiaSE no está disponible sin conexión. Abre la aplicación al menos una vez con Internet y vuelve a intentarlo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }
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
