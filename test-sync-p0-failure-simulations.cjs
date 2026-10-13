'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// POST snapshot: execute the real helper with a fake transport and assert auth/idempotency headers.
const postStart = html.indexOf('async function postSnapshot(item){');
const postEnd = html.indexOf('  async function postApi(item){', postStart);
assert.ok(postStart >= 0 && postEnd > postStart, 'postSnapshot helper must be extractable');
const postCode = html.slice(postStart, postEnd);
function makePostSnapshot(rawFetch, authHeaders = { Authorization: 'Bearer test-session-token' }) {
  return new Function('rawFetch', 'CHANNEL', 'DEVICE', 'window', 'Headers',
    postCode + '; return postSnapshot;')(
      rawFetch, 'sintergia-test-channel', 'device-A',
      { authHeadersSintergia: () => authHeaders }, Headers
    );
}
const posted = [];
const postSnapshot = makePostSnapshot(async (url, options) => {
  posted.push({ url, options });
  return { ok: true, status: 200 };
});
(async () => {
  assert.equal(await postSnapshot({ id: 'snapshot-1', createdAt: '2026-10-13T10:00:00.000Z', snapshot: { revision: 4 } }), true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].options.method, 'POST');
  assert.equal(posted[0].options.headers.get('authorization'), 'Bearer test-session-token',
    'snapshot POST must carry the authenticated session header');
  assert.equal(posted[0].options.headers.get('x-sintergia-request-id'), 'snapshot-1',
    'snapshot POST must send a stable request ID');
  assert.equal(posted[0].options.credentials, 'omit', 'cross-origin request must not rely on ambient cookies');

  // GET remote snapshot: execute the real helper and verify auth headers and returned envelope.
  const remoteStart = html.indexOf('async function obtenerRemoto(){');
  const remoteEnd = html.indexOf('function mergeEntityArrays', remoteStart);
  assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, 'GET helper must be extractable');
  const remoteCode = html.slice(remoteStart, remoteEnd);
  let getCall;
  const getRemote = new Function('backendFetch', 'SYNC_API', 'SYNC_CHANNEL', 'window',
    remoteCode + '; return obtenerRemoto;')(
      async (url, options) => {
        getCall = { url, options };
        return { ok: true, status: 200, json: async () => ({ snapshot: { revision: 4, sourceId: 'device-A' } }) };
      },
      'https://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot',
      'sintergia-test-channel',
      { authHeadersSintergia: () => ({ Authorization: 'Bearer get-session-token' }) }
    );
  const remote = await getRemote();
  assert.equal(remote.revision, 4);
  assert.equal(getCall.options.headers.Authorization, 'Bearer get-session-token');
  assert.equal(getCall.options.credentials, 'omit');
  assert.match(getCall.url, /channel=sintergia-test-channel/);

  // Simulate server accepting a POST but the response being lost in transit.
  // Execute the real snapshot queue loop and mergeQueueAfterFlush implementation.
  const qiStart = html.indexOf('function queueIdentity(item){');
  const qiEnd = html.indexOf('function entityKey', qiStart);
  assert.ok(qiStart >= 0 && qiEnd > qiStart, 'queue identity and merge helpers must be extractable');
  const queueCode = html.slice(qiStart, qiEnd);
  const storage = { changes: [{ id: 'snapshot-lost-response', attempts: 0 }] };
  const getQ = key => (storage[key] || []).map(x => ({ ...x }));
  const putQ = (key, value) => { storage[key] = value.map(x => ({ ...x })); return true; };
  const mergeQueueAfterFlush = new Function('getQ', 'putQ', queueCode + '; return mergeQueueAfterFlush;')(getQ, putQ);
  let serverAccepted = 0;
  const lostResponsePost = makePostSnapshot(async () => {
    serverAccepted++;
    storage.changes.push({ id: 'snapshot-created-during-flush', attempts: 0 });
    throw new TypeError('Failed to fetch after server accepted request');
  });
  const flushStart = html.indexOf('async function flush(){');
  const loopStart = html.indexOf('      let cq=getQ(LS.changes), keep=[];', flushStart);
  const loopEnd = html.indexOf('      /* Unsupported operation endpoint:', loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart, 'actual snapshot retry loop must be extractable');
  const loopCode = html.slice(loopStart, loopEnd);
  const loop = new Function('getQ', 'LS', 'postSnapshot', 'navigator', 'mergeQueueAfterFlush', 'now', 'okAll',
    loopCode + '; return { okAll, keep };')(
      getQ, { changes: 'changes' }, lostResponsePost,
      { onLine: true }, mergeQueueAfterFlush, () => '2026-10-13T10:01:00.000Z', true
    );
  assert.equal(serverAccepted, 1, 'the simulated server accepted the write before the response was lost');
  assert.equal(loop.okAll, false, 'lost response must not be reported as a successful flush');
  assert.equal(storage.changes.length, 2, 'original pending snapshot and concurrent new snapshot must both survive');
  assert.equal(storage.changes[0].id, 'snapshot-lost-response');
  assert.equal(storage.changes[0].attempts, 1, 'lost response must make the snapshot retryable');
  assert.equal(storage.changes[1].id, 'snapshot-created-during-flush',
    'a snapshot added during the network request must not be overwritten by queue reconciliation');

  // Quota exhausted: execute the actual write + queue helpers with storage that refuses writes.
  const writeStart = html.indexOf('function write(k,v){');
  const writeEnd = html.indexOf('  function now(){', writeStart);
  const qStart = html.indexOf('function getQ(k){');
  const qEnd = html.indexOf('function queueIdentity(item){', qStart);
  assert.ok(writeStart >= 0 && writeEnd > writeStart && qStart >= 0 && qEnd > qStart);
  const writeCode = html.slice(writeStart, writeEnd);
  const qCode = html.slice(qStart, qEnd);
  const durableMap = new Map([['changes', JSON.stringify([{ id: 'still-pending' }])]]);
  const quotaStorage = {
    getItem(key) { return durableMap.has(key) ? durableMap.get(key) : null; },
    setItem() { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; },
    removeItem(key) { durableMap.delete(key); }
  };
  const write = new Function('localStorage','pruneForQuota','LS_CORRUPT','now','isCriticalQueue','storageSize','toast',
    writeCode + '; return write;')(
      quotaStorage, () => 0, 'corrupt', () => '2026-10-13T10:02:00.000Z',
      () => true, value => Buffer.byteLength(String(value)), () => {}
    );
  const queueApi = new Function('read','write','LS','MAX_OPERATIONS','MAX_ITEMS','toast',
    qCode + '; return { getQ, putQ };')(
      (key, fallback) => { try { return JSON.parse(quotaStorage.getItem(key) || 'null') ?? fallback; } catch (_) { return fallback; } },
      write, { operations: 'operations' }, 10, 100, () => {}
    );
  assert.equal(queueApi.putQ('changes', [{ id: 'new-change' }]), false,
    'queue must report failure when storage quota prevents persistence');
  assert.deepEqual(JSON.parse(durableMap.get('changes')), [{ id: 'still-pending' }],
    'failed write must not pretend the prior durable queue was replaced');

  // Two-device merge: execute the actual entity merge helper against different revisions.
  const entityStart = html.indexOf('function mergeEntityArrays(local,incoming,collection){');
  const entityEnd = html.indexOf('window.aplicarSnapshotSincronizacion=function', entityStart);
  assert.ok(entityStart >= 0 && entityEnd > entityStart, 'entity merge helper must be extractable');
  const mergeEntities = new Function('tombstoneBlocksEntity',
    html.slice(entityStart, entityEnd) + '; return mergeEntityArrays;')(() => false);
  const merged = mergeEntities(
    [{ id: 'client-1', nombre: 'Local antiguo', revision: 1, sourceId: 'device-A' }, { id: 'client-2', nombre: 'Solo A', revision: 2 }],
    [{ id: 'client-1', nombre: 'Remoto nuevo', revision: 2, sourceId: 'device-B' }, { id: 'client-3', nombre: 'Solo B', revision: 1 }],
    'clientes'
  );
  assert.equal(merged.length, 3, 'merge must retain non-conflicting records from both devices');
  assert.equal(merged.find(x => x.id === 'client-1').nombre, 'Remoto nuevo',
    'higher revision must win deterministically');
  assert.ok(merged.some(x => x.id === 'client-2') && merged.some(x => x.id === 'client-3'));

  console.log('PASS: authenticated POST/GET, lost-response queue durability, quota failure, and two-device entity merge');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
