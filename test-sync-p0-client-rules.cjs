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

const fallbackStart = source.indexOf('let fallbackSnapshotQueued=false;');
const fallbackEnd = source.indexOf('mergeQueueAfterFlush(LS.operations,oq,opKeep);', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'unsupported operation fallback block must exist');
const fallbackBlock = source.slice(fallbackStart, fallbackEnd);
assert.match(fallbackBlock, /fallbackSnapshotQueued=!!\(fallback&&addChange\(fallback,'operations-endpoint-unsupported-fallback'\)\)/);
assert.ok(!fallbackBlock.includes('getQ(LS.changes).length===0'), 'fallback snapshot must be queued even when older snapshots are pending');
assert.match(source, /if\(operationEndpointUnsupported&&fallbackSnapshotQueued&&okAll&&keep\.length===0\)/, 'operations may be cleared only after a fallback snapshot was queued and all snapshots were acknowledged');

const permanentReject = source.indexOf("operationFallbackReason='operation-rejected-permanent';");
assert.ok(permanentReject >= 0, 'permanent operation rejection must enter snapshot fallback rather than disappear');
const permanentBlockStart = source.lastIndexOf('if(e&&e.permanent){', permanentReject);
const permanentBlockEnd = source.indexOf('}else if(e&&e.conflict){', permanentBlockStart);
const permanentBlock = source.slice(permanentBlockStart, permanentBlockEnd);
assert.match(permanentBlock, /operationEndpointUnsupported=true;/);
assert.ok(permanentBlock.includes('opKeep=oq.slice();'), 'all original operations remain queued until snapshot ACK');
assert.match(permanentBlock, /break;/);

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

  console.log('PASS: sync P0 durability, fallback, and round-trip invariants');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});


/* Regression tests for destructive queue caps discovered in follow-up audit. */
assert.ok(!source.includes('q=q.slice(-MAX_TOMBSTONES)'), 'unacknowledged deletion tombstones must never be truncated');
const tombstoneStart = source.indexOf('function putTombstones(q)');
const tombstoneEnd = source.indexOf('function rememberTombstone', tombstoneStart);
assert.ok(tombstoneStart >= 0 && tombstoneEnd > tombstoneStart, 'tombstone persistence helpers must exist');
const tombstoneBlock = source.slice(tombstoneStart, tombstoneEnd);
assert.match(tombstoneBlock, /return putQ\(LS\.tombstones,q\)/, 'tombstone persistence result must be checked by callers');
assert.match(source, /if\(!rememberTombstone\(collection,key,before,revision,sourceId,createdAt\)\)[\s\S]{0,200}throw error;/, 'delete operations must not queue without durable tombstones');
assert.match(source, /typeof window\.mergeTombstones!=='function'\|\|window\.mergeTombstones\(snapshot\.tombstones\)===false\)return false/, 'snapshot application must stop when tombstones cannot be persisted');

const conflictStart = source.indexOf('function queueConflict(item,remote,reason)');
const conflictEnd = source.indexOf('function threeWayMerge', conflictStart);
assert.ok(conflictStart >= 0 && conflictEnd > conflictStart, 'conflict persistence function must exist');
const conflictBlock = source.slice(conflictStart, conflictEnd);
assert.ok(!conflictBlock.includes('filtered.splice(0,filtered.length-MAX_CONFLICTS)'), 'pending conflicts must not be deleted to fit a cap');
assert.match(conflictBlock, /const pending=filtered\.filter\(x=>x\.status==='pending'\)/, 'pending conflicts must be preserved separately');
assert.match(conflictBlock, /const resolvedLimit=Math\.max\(0,MAX_CONFLICTS-pending\.length\);[\s\S]*const keepResolved=resolvedLimit\?resolved\.slice\(-resolvedLimit\):\[\]/, 'resolved history must be capped without using slice(-0), which keeps everything');
assert.match(conflictBlock, /if\(!putQ\(LS\.conflicts,preserved\)\)[\s\S]{0,200}throw new Error\('conflict_not_durable'\)/, 'failed conflict persistence must prevent a false successful reconciliation');

const uncertainStart = source.indexOf('function markUncertain(operationId,meta)');
const uncertainEnd = source.indexOf('function clearUncertain', uncertainStart);
assert.ok(uncertainStart >= 0 && uncertainEnd > uncertainStart, 'uncertain-operation helper must exist');
assert.ok(!source.slice(uncertainStart, uncertainEnd).includes('q.splice(0,q.length-MAX_OPERATIONS)'), 'uncertain operation references must not be truncated');

