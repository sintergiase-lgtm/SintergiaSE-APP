'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
assert.match(source, /const guardTag = '<script id="sintergia-offline-auth-guard" src="\.\/offline-guard\.js"><\/script>';/,
  'Guard injection must emit a valid literal closing script tag.');
assert.doesNotMatch(source, /<\\\\\/script>/,
  'Guard injection must not emit a backslash before the closing script tag.');
assert.match(source, /const CACHE_NAME = CACHE_PREFIX \+ 'v7';/,
  'Cache name must change so clients do not retain the old service-worker shell.');
assert.match(source, /if \(isBackend\(url, request\)\) return;/,
  'API/auth requests must bypass the shell cache.');
assert.match(source, /async function safeCacheOpen\(\)/,
  'cache initialization failures must not prevent online fetches.');
assert.match(source, /async function safeCacheMatch\(cache, request\)/,
  'cache lookup failures must degrade to a network/offline fallback.');
console.log('PASS: valid offline-guard script tag');
console.log('PASS: service-worker cache version bumped to v7');
console.log('PASS: API/auth requests bypass cache interception');

function createWorker({ openFails = false, matchFails = false, putFails = false, fetchImpl }) {
  const handlers = {};
  const cache = {
    match: async () => { if (matchFails) throw new Error('Cache match failed'); return null; },
    put: async () => { if (putFails) throw new Error('Cache put failed'); }
  };
  const self = {
    registration: { scope: 'https://app.example/' },
    location: new URL('https://app.example/'),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (name, callback) => { handlers[name] = callback; }
  };
  const caches = {
    open: async () => { if (openFails) throw new Error('Cache open failed'); return cache; },
    keys: async () => [],
    delete: async () => true
  };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Request, Response, Headers });
  return handlers;
}

function responseFor(handlers, request) {
  let result;
  handlers.fetch({ request, respondWith: promise => { result = promise; } });
  assert.ok(result, 'eligible request must install a response handler');
  return result;
}

(async () => {
  const nav = { method: 'GET', url: 'https://app.example/index.html', mode: 'navigate', destination: 'document', headers: new Headers() };
  const onlineWorker = createWorker({ openFails: true, fetchImpl: async () => new Response('<html><head></head><body>online</body></html>', { headers: { 'content-type': 'text/html' } }) });
  const onlineResponse = await responseFor(onlineWorker, nav);
  assert.equal(onlineResponse.status, 200, 'Cache.open failure must not block a successful online navigation');
  assert.match(await onlineResponse.text(), /offline-auth-guard/, 'online HTML must still receive its offline guard');

  const offlineWorker = createWorker({ openFails: true, fetchImpl: async () => { throw new Error('Network offline'); } });
  const offlineResponse = await responseFor(offlineWorker, nav);
  assert.equal(offlineResponse.status, 503, 'unavailable cache and network must resolve to the documented offline response');

  const brokenMatchWorker = createWorker({ matchFails: true, fetchImpl: async () => { throw new Error('Network offline'); } });
  const brokenMatchResponse = await responseFor(brokenMatchWorker, nav);
  assert.equal(brokenMatchResponse.status, 503, 'Cache.match failure must not leave the navigation promise rejected');

  const asset = { method: 'GET', url: 'https://app.example/app.js', mode: 'no-cors', destination: 'script', headers: new Headers() };
  const assetWorker = createWorker({ openFails: true, putFails: true, fetchImpl: async () => new Response('window.ready=true;', { headers: { 'content-type': 'text/javascript' } }) });
  const assetResponse = await responseFor(assetWorker, asset);
  assert.equal(assetResponse.status, 200, 'cache open/put failures must not block successful asset downloads');
  assert.equal(await assetResponse.text(), 'window.ready=true;');
  console.log('PASS: service-worker fetches survive Cache Storage open, match, and put failures');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

