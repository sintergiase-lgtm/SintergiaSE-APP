'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const htmlPath = process.argv[2] || '/mnt/data/SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('  async function postSnapshot(item){');
const end = html.indexOf('  async function postApi(item){', start);
assert(start >= 0 && end > start, 'postSnapshot block must exist');
const fnSource = html.slice(start, end).trim();
let request;
const context = {
  window: { authHeadersSintergia: () => ({ Authorization: 'Bearer v1.test.signature', 'Content-Type': 'application/json' }) },
  CHANNEL: 'sintergia-realtime',
  DEVICE: 'test-device',
  Headers,
  rawFetch: async (url, options) => { request = {url, options}; return {ok:true, status:200}; }
};
vm.createContext(context);
vm.runInContext(fnSource + '\nthis.postSnapshot = postSnapshot;', context);
(async () => {
  const item = { id: 'req-123', snapshot: { clientUpdatedAt: '2026-10-09T12:00:00.000Z', clients: [] }, createdAt: '2026-10-09T11:59:00.000Z' };
  assert.strictEqual(await context.postSnapshot(item), true);
  assert.strictEqual(request.url, 'https://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot');
  const headers = request.options.headers;
  assert.strictEqual(headers.get('authorization'), 'Bearer v1.test.signature', 'snapshot fallback must forward the custom session bearer');
  assert.strictEqual(headers.get('x-sintergia-request-id'), 'req-123', 'request ID must be forwarded');
  assert.strictEqual(request.options.credentials, 'omit', 'cookies must not be sent');
  const payload = JSON.parse(request.options.body);
  assert.strictEqual(payload.channel, 'sintergia-realtime');
  assert.strictEqual(payload.clientChangeId, 'req-123');
  console.log('PASS: snapshot fallback sends Bearer token, request ID, expected payload, and omits cookies');
})().catch(e => { console.error(e); process.exitCode = 1; });
