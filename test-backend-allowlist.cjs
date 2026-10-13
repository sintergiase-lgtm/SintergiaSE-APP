'use strict';

// Dynamic test of the backendFetch() allowlist.
// It extracts the REAL code from index.html (bridge script + backendFetch) and executes it,
// so it fails if the Supabase origin stops being authorized or if foreign origins become allowed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// 1) Origin configured by the bridge script
const bridge = html.match(/<script id="sintergia-supabase-github-bridge-v2">([\s\S]*?)<\/script>/);
assert.ok(bridge, 'bridge script sintergia-supabase-github-bridge-v2 must exist');
const baseMatch = bridge[1].match(/var BASE='(https:\/\/[^']+)';/);
assert.ok(baseMatch, 'bridge must declare BASE');
assert.match(bridge[1], /window\.SINTERGIA_BACKEND_ORIGIN=BASE;/, 'bridge must set SINTERGIA_BACKEND_ORIGIN');
const BASE = baseMatch[1];

// 2) SYNC_API and backendFetch taken from the real source
const syncApiMatch = html.match(/const SYNC_API='(https:\/\/[^']+)';/);
assert.ok(syncApiMatch, 'SYNC_API constant must exist');
const SYNC_API = syncApiMatch[1];
assert.equal(new URL(SYNC_API).origin, new URL(BASE).origin, 'SYNC_API origin must equal the configured backend origin');

const startIdx = html.indexOf('function backendFetch(url,options){');
const endIdx = html.indexOf('function syncToast(', startIdx);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'backendFetch block must exist');
const backendFetchSrc = html.slice(startIdx, endIdx);

function makeSandbox(backendOrigin) {
  const calls = [];
  const win = { location: new URL('https://sintergiase-lgtm.github.io/SintergiaSE-APP/') };
  if (backendOrigin !== undefined) win.SINTERGIA_BACKEND_ORIGIN = backendOrigin;
  const ctx = vm.createContext({
    window: win,
    URL,
    String,
    Set,
    Error,
    fetch: (url, options) => { calls.push({ url, options }); return Promise.resolve({ ok: true }); },
  });
  vm.runInContext(backendFetchSrc + '\nthis.backendFetch = backendFetch;', ctx);
  return { backendFetch: ctx.backendFetch, calls };
}

const blocked = (fn) => assert.throws(fn, /Endpoint de backend no permitido\./);

// Positive: configured Supabase origin + /functions/v1/ path, with and without trailing slash in the variable
for (const origin of [BASE, BASE + '/']) {
  const sb = makeSandbox(origin);
  sb.backendFetch(SYNC_API + '?channel=sintergia-realtime', { credentials: 'omit' });
  assert.equal(sb.calls.length, 1, 'allowed request must reach fetch');
  assert.equal(new URL(sb.calls[0].url).origin, new URL(BASE).origin);
}

// Negative: foreign origin, even with a functions path
{
  const sb = makeSandbox(BASE);
  blocked(() => sb.backendFetch('https://evil.example/functions/v1/realtime-snapshot'));
  blocked(() => sb.backendFetch('https://bgjicsowspppsjzigazb.supabase.co.evil.example/functions/v1/x'));
  blocked(() => sb.backendFetch('http://bgjicsowspppsjzigazb.supabase.co/functions/v1/x')); // wrong scheme = different origin
  assert.equal(sb.calls.length, 0, 'blocked requests must never reach fetch');
}

// Negative: forbidden path on the allowed backend origin
{
  const sb = makeSandbox(BASE);
  blocked(() => sb.backendFetch(BASE + '/rest/v1/app_state'));
  blocked(() => sb.backendFetch(BASE + '/auth/v1/token'));
  blocked(() => sb.backendFetch(BASE + '/storage/v1/object/x'));
  assert.equal(sb.calls.length, 0);
}

// Same origin as the app is allowed (relative URLs)
{
  const sb = makeSandbox(BASE);
  sb.backendFetch('/functions/v1/realtime-snapshot');
  assert.equal(sb.calls.length, 1);
}

// Documented dependency: without SINTERGIA_BACKEND_ORIGIN the Supabase endpoint would be refused
{
  const sb = makeSandbox(undefined);
  blocked(() => sb.backendFetch(SYNC_API));
}

console.log('PASS: backendFetch allowlist accepts only the configured Supabase origin under /functions/v1/');
