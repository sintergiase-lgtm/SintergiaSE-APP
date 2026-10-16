import assert from 'node:assert/strict';

const base = 'https://bgjicsowspppsjzigazb.supabase.co/functions/v1';
const allowedOrigin = 'https://sintergiase-app.pages.dev';
const deniedOrigin = 'https://untrusted.example';
const endpoints = ['authenticate', 'realtime-snapshot', 'sync-operations'];

for (const endpoint of endpoints) {
  for (const [origin, expected] of [[allowedOrigin, allowedOrigin], [deniedOrigin, null]]) {
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

console.log('PASS: exact Cloudflare origin allowed; untrusted origin rejected on 3 production endpoints');
