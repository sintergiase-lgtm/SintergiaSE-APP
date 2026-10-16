/* One-time migration away from the retired GitHub Pages app. */
'use strict';
const CANONICAL_APP = 'https://sintergiase-app.pages.dev/';
const RETIRED_CACHE_PREFIX = 'sintergiase-shell-';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(RETIRED_CACHE_PREFIX))
      .map(name => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map(client => client.navigate(CANONICAL_APP).catch(() => undefined)));
    await self.registration.unregister();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(Response.redirect(CANONICAL_APP, 302));
  }
});
