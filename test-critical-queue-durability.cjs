'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html'];

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label}: source boundaries must exist`);
  return source.slice(start, end);
}

function createQueueHarness(initial = {}, failingKeys = []) {
  const queues = structuredClone(initial);
  const failed = new Set(failingKeys);
  const calls = [];
  const deps = {
    LS: { tombstones: 'tombstones', changes: 'changes', operations: 'operations', uncertain: 'uncertain', conflicts: 'conflicts', deferred: 'deferred', snapshot: 'snapshot' },
    MAX_TOMBSTONES: 1,
    MAX_OPERATIONS: 1,
    MAX_CONFLICTS: 1,
    DEVICE: 'device-1',
    now: () => '2026-10-14T08:00:00.000Z',
    uuid: (() => { let id = 0; return () => `generated-${++id}`; })(),
    toast: message => calls.push(['toast', message]),
    window: { __sgIgn: error => calls.push(['error', error]) },
    stableJson: value => JSON.stringify(value ?? null),
    entityKey: value => String(value?.id ?? value?.uid ?? value?.ref ?? value?.referencia ?? value?.numero ?? value?.codigo ?? ''),
    tombstoneId: (collection, key) => `${collection}::${key}`,
    getQ: key => structuredClone(queues[key] || []),
    putQ: (key, value) => {
      calls.push(['putQ', key, value.length]);
      if (failed.has(key)) return false;
      queues[key] = structuredClone(value);
      return true;
    },
    read: key => key === 'snapshot' ? (queues.snapshot || null) : null,
    write: (key, value) => {
      calls.push(['write', key]);
      if (failed.has(key)) return false;
      queues[key] = structuredClone(value);
      return true;
    },
    pruneAckedOperations: value => value,
    conflictKey: item => `${item?.collection || ''}::${item?.key || ''}`,
  };
  return { deps, queues, calls };
}

function loadFunction(args, source, name) {
  return new Function(...args.keys, `${source}\nreturn ${name};`)(...args.values);
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const offline = html.match(/<script id="sintergia-offline-first-v3">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(offline, `${page}: offline module must exist`);

  const helperSource = between(offline, 'function getTombstones()', '  function tombstoneBlocksEntity', `${page} tombstone helpers`);
  const harness = createQueueHarness();
  const helperFactory = new Function('deps', `
    const {getQ,putQ,LS,MAX_TOMBSTONES,toast,DEVICE,now,tombstoneId}=deps;
    ${helperSource}
    return {getTombstones,putTombstones,rememberTombstone,mergeTombstones};
  `);
  const tombstones = helperFactory(harness.deps);
  const manyTombstones = Array.from({ length: 3 }, (_, i) => ({ id: `clientes::${i}`, collection: 'clientes', key: String(i) }));
  assert.equal(tombstones.putTombstones(manyTombstones), true, `${page}: oversized tombstone queues stay durable`);
  assert.equal(harness.queues.tombstones.length, 3, `${page}: no deletion marker is truncated to a threshold`);
  assert.ok(harness.calls.some(([type, message]) => type === 'toast' && /se conservan todas/.test(message)), `${page}: oversized queues show a warning`);

  const failingTombstoneStore = createQueueHarness({}, ['tombstones']);
  const failingHelpers = helperFactory(failingTombstoneStore.deps);
  assert.equal(failingHelpers.rememberTombstone('clientes', 'deleted-1', { id: 'deleted-1' }, 3, 'device-1'), false,
    `${page}: a failed tombstone write must be reported to the caller`);
  assert.equal(failingHelpers.mergeTombstones([{ id: 'clientes::remote', collection: 'clientes', key: 'remote' }]), false,
    `${page}: a failed merge write must not report success`);

  const buildSource = between(offline, '  function buildOperations(', '  function addChange(', `${page} buildOperations`);
  const failingDeleteHarness = createQueueHarness({}, ['tombstones']);
  const buildOperations = new Function('deps', `
    const {getQ,putQ,LS,MAX_TOMBSTONES,toast,DEVICE,now,tombstoneId,stableJson,entityKey,uuid}=deps;
    ${helperSource}
    ${buildSource}
    return buildOperations;
  `)(failingDeleteHarness.deps);
  assert.throws(() => buildOperations({ clientes: [{ id: 'deleted-2' }] }, { clientes: [] }, 'regression'),
    error => error && error.message === 'tombstone_not_durable' && error.durable === false,
    `${page}: a delete operation must not be created without its durable tombstone`);
  assert.deepEqual(failingDeleteHarness.queues.operations || [], [], `${page}: failed tombstone persistence cannot queue a delete`);
  const durableDeleteHarness = createQueueHarness();
  const durableBuildOperations = new Function('deps', `
    const {getQ,putQ,LS,MAX_TOMBSTONES,toast,DEVICE,now,tombstoneId,stableJson,entityKey,uuid}=deps;
    ${helperSource}
    ${buildSource}
    return buildOperations;
  `)(durableDeleteHarness.deps);
  const durableDeleteOps = durableBuildOperations({ clientes: [{ id: 'deleted-3' }] }, { clientes: [] }, 'regression');
  assert.equal(durableDeleteOps[0]?.op, 'delete', `${page}: a delete operation remains available after its tombstone persists`);
  assert.equal(durableDeleteHarness.queues.tombstones[0]?.id, 'clientes::deleted-3');

  const addChangeSource = between(offline, '  function addChange(snapshot,reason){', '  function ', `${page} addChange`);
  const failedChangeHarness = createQueueHarness();
  const addChange = new Function('deps', `
    const {read,LS,DEVICE,now,uuid,buildOperations,getQ,putQ,toast,window,pruneAckedOperations,write}=deps;
    ${addChangeSource}
    return addChange;
  `)({ ...failedChangeHarness.deps, buildOperations: () => { throw Object.assign(new Error('tombstone_not_durable'), { durable: false }); } });
  assert.equal(addChange({ clientes: [] }, 'regression'), false, `${page}: addChange must contain tombstone durability failures`);
  assert.deepEqual(failedChangeHarness.queues.changes || [], [], `${page}: failed tombstone creation must stop snapshot enqueue`);

  const failedOperationQueueHarness = createQueueHarness({}, ['operations']);
  const addChangeWithOperation = new Function('deps', `
    const {read,LS,DEVICE,now,uuid,buildOperations,getQ,putQ,toast,window,pruneAckedOperations,write}=deps;
    ${addChangeSource}
    return addChange;
  `)({ ...failedOperationQueueHarness.deps, buildOperations: () => [{ operationId: 'op-1' }] });
  assert.equal(addChangeWithOperation({ clientes: [] }, 'regression'), false, `${page}: addChange must report an operation-queue write failure`);
  assert.deepEqual(failedOperationQueueHarness.queues.operations || [], [], `${page}: failed operation persistence must not claim success`);

  const uncertainSource = between(offline, 'function markUncertain(operationId,meta){', '  function clearUncertain', `${page} uncertain operations`);
  const uncertainHarness = createQueueHarness();
  const markUncertain = loadFunction(
    { keys: ['getQ', 'putQ', 'LS', 'MAX_OPERATIONS', 'toast', 'now'], values: [uncertainHarness.deps.getQ, uncertainHarness.deps.putQ, uncertainHarness.deps.LS, 1, uncertainHarness.deps.toast, uncertainHarness.deps.now] },
    uncertainSource,
    'markUncertain',
  );
  for (let i = 0; i < 3; i++) markUncertain(`uncertain-${i}`, {});
  assert.equal(uncertainHarness.queues.uncertain.length, 3, `${page}: uncertain operation references are not truncated`);
  const failingUncertain = createQueueHarness({}, ['uncertain']);
  const failingMarkUncertain = loadFunction(
    { keys: ['getQ', 'putQ', 'LS', 'MAX_OPERATIONS', 'toast', 'now'], values: [failingUncertain.deps.getQ, failingUncertain.deps.putQ, failingUncertain.deps.LS, 1, failingUncertain.deps.toast, failingUncertain.deps.now] },
    uncertainSource,
    'markUncertain',
  );
  assert.equal(failingMarkUncertain('uncertain-fail', {}), false, `${page}: uncertain reference persistence failure is surfaced`);

  const conflictSource = between(offline, '  function queueConflict(item,remote,reason){', '  function threeWayMerge', `${page} conflict queue`);
  const conflictHarness = createQueueHarness();
  const queueConflict = new Function('deps', `
    const {getQ,putQ,LS,MAX_CONFLICTS,toast,DEVICE,now,uuid,conflictKey}=deps;
    ${conflictSource}
    return queueConflict;
  `)(conflictHarness.deps);
  const pendingItem = (operationId, key = 'shared-client') => ({ operationId, collection: 'clientes', key, before: null, after: { id: key, operationId } });
  queueConflict(pendingItem('conflict-1'), null, '409');
  queueConflict(pendingItem('conflict-2'), null, '409');
  const third = queueConflict(pendingItem('conflict-3'), null, '409');
  assert.equal(conflictHarness.queues.conflicts.length, 3, `${page}: pending conflicts are never discarded to fit a cap`);
  const retried = queueConflict(pendingItem('conflict-3'), { version: 2 }, '409-retry');
  assert.equal(retried.id, third.id, `${page}: a retry updates its existing conflict record`);
  assert.equal(conflictHarness.queues.conflicts.length, 3, `${page}: retrying the same conflict does not add duplicates`);
  const historyHarness = createQueueHarness({ conflicts: [{ id: 'resolved-old', status: 'resolved' }, { id: 'resolved-new', status: 'resolved' }] });
  historyHarness.deps.MAX_CONFLICTS = 2;
  const historyQueueConflict = new Function('deps', `
    const {getQ,putQ,LS,MAX_CONFLICTS,toast,DEVICE,now,uuid,conflictKey}=deps;
    ${conflictSource}
    return queueConflict;
  `)(historyHarness.deps);
  historyQueueConflict(pendingItem('conflict-4'), null, '409');
  assert.deepEqual(historyHarness.queues.conflicts.filter(x => x.status === 'resolved').map(x => x.id), ['resolved-new'],
    `${page}: resolved history is capped while pending conflicts remain intact`);
  const failingConflict = createQueueHarness({}, ['conflicts']);
  const failQueueConflict = new Function('deps', `
    const {getQ,putQ,LS,MAX_CONFLICTS,toast,DEVICE,now,uuid,conflictKey}=deps;
    ${conflictSource}
    return queueConflict;
  `)(failingConflict.deps);
  assert.throws(() => failQueueConflict(pendingItem('conflict-fail'), null, '409'), /conflict_not_durable/,
    `${page}: conflict persistence errors must not be silently acknowledged`);

  const deferredProperty = between(offline, 'defer:function(type,payload)', '\n    snapshot:function', `${page} defer API`).trim().replace(/,$/, '');
  const deferredHarness = createQueueHarness();
  const defer = new Function('deps', `
    const {getQ,putQ,LS,uuid,now,DEVICE}=deps;
    const offlineApi={${deferredProperty}};
    return offlineApi.defer;
  `)(deferredHarness.deps);
  assert.equal(defer('api-call', { id: 'deferred-1' }), true, `${page}: defer reports durable writes`);
  const failingDeferred = createQueueHarness({}, ['deferred']);
  const failDefer = new Function('deps', `
    const {getQ,putQ,LS,uuid,now,DEVICE}=deps;
    const offlineApi={${deferredProperty}};
    return offlineApi.defer;
  `)(failingDeferred.deps);
  assert.equal(failDefer('api-call', {}), false, `${page}: defer reports storage failures`);

  const snapshotProperty = between(offline, '    queueSnapshot:function(reason,providedSnapshot){', '    flush:async', `${page} queueSnapshot API`).trim().replace(/,$/, '');
  const snapshotValue = { clientes: [{ id: 'snapshot-1' }] };
  const snapshotFn = new Function('deps', `
    const {DEVICE,addChange,createSnapshot}=deps;
    const offlineApi={snapshot:createSnapshot,${snapshotProperty}};
    return offlineApi.queueSnapshot;
  `);
  const queueSnapshot = snapshotFn({ DEVICE: 'device-1', createSnapshot: () => snapshotValue, addChange: () => true });
  assert.deepEqual(queueSnapshot.call({ snapshot: () => snapshotValue }, 'provided', snapshotValue), { ...snapshotValue, deviceId: 'device-1' },
    `${page}: provided snapshots are copied and queued`);
  const failedSnapshot = snapshotFn({ DEVICE: 'device-1', createSnapshot: () => snapshotValue, addChange: () => false });
  assert.equal(failedSnapshot.call({ snapshot: () => snapshotValue }, 'failed', snapshotValue), null,
    `${page}: queueSnapshot must not return an unpersisted snapshot as queued`);

  const applySource = between(html, 'window.aplicarSnapshotSincronizacion=function(snapshot){', '\nwindow.probarSincronizacionMultidispositivo', `${page} snapshot application`);
  function applyWith(tombstoneResult) {
    const windowState = {
      appState: { clientes: [{ id: 'local-1' }] },
      mergeTombstones: () => tombstoneResult,
      guardarEstadoStorage() {},
      renderizarTodo() {},
    };
    const localStorage = { getItem: () => '0', setItem() {} };
    const sessionStorage = { getItem: () => 'device-local' };
    const applySnapshot = new Function('window', 'localStorage', 'sessionStorage', 'mergeEntityArrays', 'tombstoneBlocksEntity', `
      ${applySource}
      return window.aplicarSnapshotSincronizacion;
    `)(windowState, localStorage, sessionStorage, (_local, incoming) => incoming || [], () => false);
    return { windowState, applySnapshot };
  }
  const noTombstones = applyWith(true);
  assert.equal(noTombstones.applySnapshot({ revision: 1, clientes: [{ id: 'remote-no-tombstones' }] }), true,
    `${page}: snapshots without tombstones still apply`);
  assert.deepEqual(noTombstones.windowState.appState.clientes, [{ id: 'remote-no-tombstones' }]);
  const persistableTombstones = applyWith(true);
  assert.equal(persistableTombstones.applySnapshot({ revision: 1, tombstones: [{ id: 'clientes::remote' }], clientes: [{ id: 'remote-tombstone' }] }), true,
    `${page}: snapshots apply after tombstones persist`);
  assert.deepEqual(persistableTombstones.windowState.appState.clientes, [{ id: 'remote-tombstone' }]);
  const failedTombstoneApplication = applyWith(false);
  assert.equal(failedTombstoneApplication.applySnapshot({ revision: 1, tombstones: [{ id: 'clientes::remote' }], clientes: [{ id: 'remote-1' }] }), false,
    `${page}: a snapshot is rejected when its tombstones cannot be persisted`);
  assert.deepEqual(failedTombstoneApplication.windowState.appState.clientes, [{ id: 'local-1' }], `${page}: remote entity state stays unapplied after tombstone storage failure`);

  console.log(`PASS: ${page} durable tombstones, conflict retention, uncertain-operation retention, and truthful queue APIs`);
}

