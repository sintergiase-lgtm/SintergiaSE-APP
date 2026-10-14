'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function createHarness(flushSource, overrides = {}) {
  const calls = { states: [], journal: [], refresh: 0, release: 0, recover: 0, acquire: 0, errors: [] };
  const deps = {
    initialFlushing: false,
    authBlocksFlush: () => false,
    setSyncState: (...args) => calls.states.push(args),
    recoverStaleLease: () => { calls.recover++; },
    acquireFlushLease: () => { calls.acquire++; return true; },
    refreshFlushLease: () => { calls.refresh++; },
    releaseFlushLease: () => { calls.release++; },
    appendJournal: (...args) => calls.journal.push(args),
    navigator: { onLine: true },
    window: { __sgIgn: error => calls.errors.push(error) },
    ...overrides
  };
  const factory = new Function('deps', `
    let flushing=Boolean(deps.initialFlushing);
    const {authBlocksFlush,setSyncState,recoverStaleLease,acquireFlushLease,
      refreshFlushLease,releaseFlushLease,appendJournal,navigator,window}=deps;
    ${flushSource}
    return {flush,isFlushing:()=>flushing};
  `);
  return { ...factory(deps), calls };
}

function createQueueHarness(flushSource, queueHelperSource, initialQueues, handlers = {}) {
  const queues = Object.fromEntries(Object.entries(initialQueues).map(([key, value]) => [key, structuredClone(value)]));
  const online = { value: true };
  const calls = { states: [], journal: [], refresh: 0, release: 0, errors: [], writes: [] };
  const clone = value => structuredClone(value);
  const deps = {
    authBlocksFlush: () => false,
    setSyncState: (...args) => calls.states.push(args),
    recoverStaleLease() {},
    acquireFlushLease: () => true,
    refreshFlushLease: () => { calls.refresh++; },
    releaseFlushLease: () => { calls.release++; },
    appendJournal: (...args) => calls.journal.push(args),
    navigator: { get onLine() { return online.value; }, set onLine(value) { online.value = value; } },
    window: {
      __sgIgn: error => calls.errors.push(error),
      SintergiaOffline: { snapshot: () => ({ id: 'fallback-snapshot', revision: 1 }) }
    },
    LS: { api: 'api', operations: 'operations', changes: 'changes', conflicts: 'conflicts', meta: 'meta' },
    getQ: key => clone(queues[key] || []),
    putQ: (key, value) => { queues[key] = clone(value); return true; },
    stableJson: value => JSON.stringify(value ?? null),
    now: () => new Date().toISOString(),
    postApi: handlers.postApi || (async () => true),
    postOperation: handlers.postOperation || (async () => true),
    reconcileConflict: async () => null,
    postSnapshot: handlers.postSnapshot || (async () => true),
    addChange(snapshot) { queues.changes = [...(queues.changes || []), clone(snapshot)]; },
    toast() {},
    write: (key, value) => { calls.writes.push([key, clone(value)]); return true; },
    clearSyncRetry() {},
    scheduleSyncRetry() {}
  };
  const factory = new Function('deps', `
    let flushing=false;
    const {authBlocksFlush,setSyncState,recoverStaleLease,acquireFlushLease,
      refreshFlushLease,releaseFlushLease,appendJournal,navigator,window,LS,getQ,putQ,
      stableJson,now,postApi,postOperation,reconcileConflict,postSnapshot,addChange,
      toast,write,clearSyncRetry,scheduleSyncRetry}=deps;
    ${queueHelperSource}
    ${flushSource}
    return {flush,isFlushing:()=>flushing};
  `);
  return { ...factory(deps), queues, online, calls };
}

(async () => {
  for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const offlineScript = html.match(/<script id="sintergia-offline-first-v3">([\s\S]*?)<\/script>/i)?.[1];
    assert.ok(offlineScript, `${file}: offline-first script must exist`);
    const start = offlineScript.indexOf('async function flush(){');
    const end = offlineScript.indexOf('\n  async function replayDeferred(){', start);
    assert.ok(start >= 0 && end > start, `${file}: flush boundaries must be found`);
    const flushSource = offlineScript.slice(start, end);
    const queueHelperStart = offlineScript.indexOf('function queueIdentity(item){');
    const queueHelperEnd = offlineScript.indexOf('\n  function tombstoneId', queueHelperStart);
    assert.ok(queueHelperStart >= 0 && queueHelperEnd > queueHelperStart, `${file}: queue merge helpers must exist`);
    const queueHelperSource = offlineScript.slice(queueHelperStart, queueHelperEnd)
      .replace(/function stableJson\(x\)\{try\{return JSON\.stringify\(x\?\?null\);\}catch\(_\)\{return '';\}\}\s*/, '');

    const preambleFailure = new Error('auth state unavailable');
    const preamble = createHarness(flushSource, { authBlocksFlush: () => { throw preambleFailure; } });
    assert.equal(await preamble.flush(), false, `${file}: pre-lease errors should resolve safely`);
    assert.equal(preamble.calls.errors[0], preambleFailure);
    assert.equal(preamble.calls.release, 0, `${file}: must not release a lease it never acquired`);
    assert.equal(preamble.isFlushing(), false);

    const startJournalFailure = new Error('journal storage unavailable');
    const afterLease = createHarness(flushSource, {
      appendJournal: (event, details) => {
        if (event === 'flush-start') throw startJournalFailure;
      }
    });
    assert.equal(await afterLease.flush(), false, `${file}: setup errors should not reject or strand the flush`);
    assert.equal(afterLease.calls.release, 1, `${file}: an acquired lease must be released after setup failure`);
    assert.equal(afterLease.calls.refresh, 1);
    assert.equal(afterLease.isFlushing(), false);

    const offline = createHarness(flushSource, { navigator: { onLine: false } });
    assert.equal(await offline.flush(), false, `${file}: offline flush must stop without sending`);
    assert.equal(offline.isFlushing(), false, `${file}: offline return must clear this flush flag`);
    assert.equal(offline.calls.release, 1, `${file}: offline return must release its lease`);
    assert.ok(offline.calls.journal.some(([event]) => event === 'flush-end'));
    assert.ok(offline.calls.states.some(([state]) => state === 'offline'));

    const busy = createHarness(flushSource, { initialFlushing: true });
    assert.equal(await busy.flush(), false, `${file}: concurrent flush must be skipped`);
    assert.equal(busy.isFlushing(), true, `${file}: skipped concurrent flush must preserve the active flag`);
    assert.equal(busy.calls.release, 0, `${file}: skipped concurrent flush must not release another lease`);
    assert.equal(busy.calls.recover, 0);

    const apiQueue = createQueueHarness(flushSource, queueHelperSource, {
      api: [{ id: 'api-1' }, { id: 'api-2' }], operations: [], changes: [], conflicts: []
    }, { postApi: async () => { apiQueue.online.value = false; throw new Error('network dropped'); } });
    assert.equal(await apiQueue.flush(), false);
    assert.deepEqual(apiQueue.queues.api.map(item => item.id), ['api-1', 'api-2'], `${file}: API items after a mid-flush disconnect must remain queued`);
    assert.equal(apiQueue.queues.api[0].attempts, 1);

    const concurrentApiQueue = createQueueHarness(flushSource, queueHelperSource, {
      api: [{ id: 'api-before-flush' }], operations: [], changes: [], conflicts: []
    }, { postApi: async () => { concurrentApiQueue.queues.api.push({ id: 'api-added-during-request' }); return true; } });
    assert.equal(await concurrentApiQueue.flush(), true);
    assert.deepEqual(concurrentApiQueue.queues.api.map(item => item.id), ['api-added-during-request'],
      `${file}: a queue item added while awaiting the backend must not be overwritten`);

    const operationQueue = createQueueHarness(flushSource, queueHelperSource, {
      api: [], operations: [{ id: 'op-1' }, { id: 'op-2' }], changes: [], conflicts: []
    }, { postOperation: async () => { operationQueue.online.value = false; throw new Error('network dropped'); } });
    assert.equal(await operationQueue.flush(), false);
    assert.deepEqual(operationQueue.queues.operations.map(item => item.id), ['op-1', 'op-2'], `${file}: unattempted idempotent operations must remain queued`);

    const snapshotQueue = createQueueHarness(flushSource, queueHelperSource, {
      api: [], operations: [], changes: [{ id: 'snapshot-1' }, { id: 'snapshot-2' }], conflicts: []
    }, { postSnapshot: async () => { snapshotQueue.online.value = false; throw new Error('network dropped'); } });
    assert.equal(await snapshotQueue.flush(), false);
    assert.deepEqual(snapshotQueue.queues.changes.map(item => item.id), ['snapshot-1', 'snapshot-2'], `${file}: unattempted snapshots must remain queued`);

    const unsupported = createQueueHarness(flushSource, queueHelperSource, {
      api: [], operations: [{ id: 'op-unsupported' }], changes: [], conflicts: []
    }, { postOperation: async () => ({ unsupported: true }) });
    assert.equal(await unsupported.flush(), true, `${file}: snapshot fallback should confirm successfully`);
    assert.deepEqual(unsupported.queues.operations, [], `${file}: operations may be cleared only after their fallback snapshot is acknowledged`);
    assert.deepEqual(unsupported.queues.changes, []);

    const fallbackNotAcknowledged = createQueueHarness(flushSource, queueHelperSource, {
      api: [], operations: [{ id: 'op-unacknowledged' }], changes: [], conflicts: []
    }, {
      postOperation: async () => ({ unsupported: true }),
      postSnapshot: async () => { throw new Error('snapshot not acknowledged'); }
    });
    assert.equal(await fallbackNotAcknowledged.flush(), false, `${file}: an unacknowledged snapshot must keep the flush incomplete`);
    assert.equal(fallbackNotAcknowledged.queues.operations.length, 1, `${file}: unacknowledged fallback must not drop operations`);
    assert.equal(fallbackNotAcknowledged.queues.changes.length, 1, `${file}: failed fallback snapshot must remain queued`);
    console.log(`PASS: ${file} flush error cleanup, offline exit, and lease ownership`);
    console.log(`PASS: ${file} preserves API, operation, and snapshot queues and confirms fallback before clearing`);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
