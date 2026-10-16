import assert from 'node:assert/strict';

const base = 'https://bgjicsowspppsjzigazb.supabase.co/functions/v1';
const allowedOrigin = 'https://sintergiase-app.pages.dev';
const deniedOrigin = 'https://untrusted.example';
const endpoints = ['authenticate', 'realtime-snapshot', 'sync-operations'];

const previewOrigin = 'https://fix-shared-limited-json-body.sintergiase-app.pages.dev';
const originCases = [
  [allowedOrigin, allowedOrigin],
  [deniedOrigin, null],
  [previewOrigin, null]
];

for (const endpoint of endpoints) {
  for (const [origin, expected] of originCases) {
    const response = await fetch(base + '/' + endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': endpoint === 'sync-operations' ? 'POST' : 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,apikey,x-sintergia-request-id'
      },
      signal: AbortSignal.timeout(10000)
    });

    assert.equal(response.status, 204, endpoint + ' preflight status for ' + origin);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      expected,
      endpoint + ' CORS origin decision for ' + origin
    );
    assert.equal(
      response.headers.get('access-control-allow-credentials'),
      null,
      endpoint + ' must not enable credentialed cross-origin requests'
    );
  }
}

console.log('PASS: production origin allowed; untrusted and current Cloudflare branch-preview origins rejected on 3 endpoints');
