'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

assert.match(source, /function isCriticalQueue\(k\)\{return \[LS\.changes,LS\.operations,LS\.api,LS\.deferred,LS\.conflicts,LS\.tombstones\]\.includes\(k\);\}/);
assert.ok(!source.includes('q=q.slice(-limit)'), 'pending queues must never be truncated');
assert.ok(!source.includes('oq.splice(0,oq.length-MAX_OPERATIONS)'), 'operation queue must never be truncated');
assert.match(source, /function pruneForQuota\(excludeKey\)\{\s*void excludeKey;\s*return 0;/);
assert.match(source, /legacy_sync_record_requires_reconciliation/);
assert.match(source, /operation_incomplete/);
assert.match(source, /return \{fallbackSnapshot:true,reason:recoveryError\|\|'snapshot-fallback-required'\};/);
assert.match(source, /const confirmed=published&&snapshotCoincideConRemoto\(snap,remote\);/);
assert.match(source, /snapshotCoincideConRemoto\(local,remote\)/);
assert.match(source, /remoteRevision===localRevision/);
assert.ok(!source.includes('remoteRevision>=localRevision'), 'a newer remote revision must not falsely confirm this snapshot');
assert.match(source, /SINTERGIA_BACKEND_ORIGIN/);
assert.match(source, /headers=typeof window\.authHeadersSintergia==='function'\?window\.authHeadersSintergia\(\):\{\}/);

const start = source.indexOf('  async function postOperation(item){');
const end = source.indexOf('  async function postSnapshot(item){', start);
assert.ok(start >= 0 && end > start, 'postOperation block must exist');

class TestHeaders {
  constructor(init) { this.values = new Map(Object.entries(init || {})); }
  set(key, value) { this.values.set(String(key).toLowerCase(), String(value)); }
  get(key) { return this.values.get(String(key).toLowerCase()); }
}

const buildPostOperation = new Function(
  'rawFetch', 'CFG', 'CHANNEL', 'DEVICE', 'window', 'Headers', 'now',
  'operationValid', 'journalAck', 'clearUncertain',
  source.slice(start, end) + '; return postOperation;',
);

const operation = {
  operationId: 'op-1', op: 'upsert', collection: 'clientes', key: 'c-1',
  before: null, after: { id: 'c-1' }, revision: 1, sourceId: 'dev-1',
  createdAt: '2026-10-13T10:00:00.000Z',
};

(async () => {
  for (const error of [
    'legacy_sync_record_requires_reconciliation',
    'operation_incomplete',
    'snapshot_payload_required',
  ]) {
    const postOperation = buildPostOperation(
      async () => ({ status: 503, json: async () => ({ error }) }),
      { sync: {} }, 'channel', 'device', {}, TestHeaders,
      () => '2026-10-13T10:00:00.000Z', () => true, () => {}, () => {},
    );
    assert.deepEqual(await postOperation(operation), { fallbackSnapshot: true, reason: error });
  }

  const postOperation = buildPostOperation(
    async () => ({ status: 503, json: async () => ({ error: 'sync_unavailable' }) }),
    { sync: {} }, 'channel', 'device', {}, TestHeaders,
    () => '2026-10-13T10:00:00.000Z', () => true, () => {}, () => {},
  );
  await assert.rejects(() => postOperation(operation), /HTTP 503/);

  // Exercise the actual backend allowlist helper extracted from index.html (not just a text match).
  const bridgeOriginIndex = source.indexOf("window.SINTERGIA_BACKEND_ORIGIN=BASE");
  const backendFetchStart = source.indexOf("function backendFetch(url,options){");
  const backendFetchEnd = source.indexOf("\\nfunction syncToast", backendFetchStart);
  assert.ok(bridgeOriginIndex >= 0 && backendFetchStart > bridgeOriginIndex,
    'Supabase backend origin must be configured before the sync helper runs');
  assert.ok(backendFetchEnd > backendFetchStart, 'backendFetch helper must be extractable for a runtime allowlist test');
  const backendFetchFactory = new Function('window', 'fetch', 'URL',
    source.slice(backendFetchStart, backendFetchEnd) + '; return backendFetch;');
  const fetchCalls = [];
  const backendWindow = {
    location: { origin: 'https://sintergiase-lgtm.github.io' },
    SINTERGIA_BACKEND_ORIGIN: 'https://bgjicsowspppsjzigazb.supabase.co',
  };
  const checkedFetch = backendFetchFactory(backendWindow, async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, status: 200 };
  }, URL);
  await checkedFetch('https://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot', { method: 'GET' });
  assert.equal(fetchCalls.length, 1, 'configured Supabase Edge Function origin must be accepted');
  assert.match(fetchCalls[0].url, /^https:\\/\\/bgjicsowspppsjzigazb\\.supabase\\.co\\/functions\\/v1\\//);
  assert.throws(() => checkedFetch('https://evil.example/functions/v1/realtime-snapshot'), /Endpoint de backend no permitido/,
    'an untrusted origin must be rejected even when it uses an Edge Function path');
  assert.throws(() => checkedFetch('https://bgjicsowspppsjzigazb.supabase.co/rest/v1/users'), /Endpoint de backend no permitido/,
    'the configured backend origin must not allow arbitrary non-Edge-Function paths');

  console.log('PASS: sync P0 durability, fallback, and round-trip invariants');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
