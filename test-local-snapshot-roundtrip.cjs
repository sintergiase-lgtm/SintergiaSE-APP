'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APP_ENDPOINT = 'https://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot';
const localEndpoint = new URL(process.env.SNAPSHOT_QA_ENDPOINT || 'http://127.0.0.1:54321/functions/v1/realtime-snapshot');
assert.ok(['127.0.0.1', 'localhost'].includes(localEndpoint.hostname),
  'synthetic QA must never send requests outside localhost');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const postStart = html.indexOf('async function postSnapshot(item){');
const postEnd = html.indexOf('\n  async function postApi(item){', postStart);
assert.ok(postStart >= 0 && postEnd > postStart, 'the application postSnapshot function must be present');
const postSnapshotSource = html.slice(postStart, postEnd);

const remoteStart = html.indexOf('async function obtenerRemoto(){');
const remoteEnd = html.indexOf('\nfunction mergeEntityArrays', remoteStart);
assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, 'the application obtenerRemoto function must be present');
const obtenerRemotoSource = html.slice(remoteStart, remoteEnd);

const comparatorStart = html.indexOf('function snapshotCoincideConRemoto(local,remote){');
const comparatorEnd = html.indexOf('\n}', comparatorStart);
assert.ok(comparatorStart >= 0 && comparatorEnd > comparatorStart, 'the exact source/revision comparator must be present');
const comparatorSource = html.slice(comparatorStart, comparatorEnd + 2);
const snapshotCoincideConRemoto = new Function(
  comparatorSource + '; return snapshotCoincideConRemoto;',
)();

const migrationPath = path.join(__dirname, 'qa', 'supabase', 'migrations', '20261014090000_local_snapshot_qa.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const secretMatch = migration.match(/values\s*\(\s*'session_hmac'\s*,\s*'([^']+)'\s*\)/i);
assert.ok(secretMatch, 'the isolated migration must seed a synthetic HMAC secret');
const hmacSecret = secretMatch[1];
const payload = Buffer.from(JSON.stringify({
  sub: 'local-qa-user',
  tenant: 'sintergia',
  exp: Math.floor(Date.now() / 1000) + 300,
})).toString('base64url');
const signature = crypto.createHmac('sha256', hmacSecret).update(payload).digest('base64url');
const sessionToken = `v1.${payload}.${signature}`;

function makeWindow(token) {
  return {
    authHeadersSintergia() {
      return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    },
  };
}

const makePostSnapshot = new Function(
  'rawFetch', 'CHANNEL', 'DEVICE', 'window', 'Headers', 'pauseSyncForAuth',
  postSnapshotSource + '; return postSnapshot;',
);
const makeObtenerRemoto = new Function(
  'backendFetch', 'SYNC_API', 'SYNC_CHANNEL', 'window',
  obtenerRemotoSource + '; return obtenerRemoto;',
);

function makeDevice(deviceId) {
  const window = makeWindow(sessionToken);
  const rawFetch = async (url, options) => {
    assert.equal(String(url), APP_ENDPOINT, 'the application must target its configured snapshot function');
    assert.equal(options.credentials, 'omit');
    const headers = new Headers(options.headers);
    headers.set('Origin', 'https://sintergiase-lgtm.github.io');
    assert.equal(headers.get('authorization'), `Bearer ${sessionToken}`, 'POST must use the current HMAC session');
    assert.ok(headers.get('x-sintergia-request-id'), 'POST must include its idempotency/request identifier');
    const response = await fetch(localEndpoint, { ...options, headers });
    if (!response.ok) {
      console.error(`Local snapshot request failed: HTTP ${response.status}: ${await response.clone().text()}`);
    }
    return response;
  };
  const backendFetch = async (url, options) => {
    const remoteUrl = new URL(url);
    assert.equal(remoteUrl.origin, new URL(APP_ENDPOINT).origin);
    assert.equal(remoteUrl.pathname, new URL(APP_ENDPOINT).pathname);
    assert.equal(options.credentials, 'omit');
    const headers = new Headers(options.headers);
    headers.set('Origin', 'https://sintergiase-lgtm.github.io');
    assert.equal(headers.get('authorization'), `Bearer ${sessionToken}`, 'GET must use the current HMAC session');
    return fetch(new URL(remoteUrl.search, localEndpoint), { ...options, headers });
  };
  return {
    postSnapshot: makePostSnapshot(
      rawFetch, 'sintergia-realtime', deviceId, window, Headers,
      () => { throw new Error('an authenticated request unexpectedly paused sync'); },
    ),
    obtenerRemoto: makeObtenerRemoto(
      backendFetch, APP_ENDPOINT, 'sintergia-realtime', window,
    ),
  };
}

async function main() {
  const noSession = await fetch(localEndpoint);
  assert.equal(noSession.status, 401, 'the local endpoint must reject an absent session');

  const invalidSession = await fetch(localEndpoint, {
    headers: { Authorization: 'Bearer v1.e30.invalid' },
  });
  const invalidBody = await invalidSession.text();
  assert.equal(invalidSession.status, 401,
    `the local endpoint must reject an invalid signature; got HTTP ${invalidSession.status}: ${invalidBody}`);

  const deviceA = makeDevice('qa-device-a');
  const snapshotA = {
    sourceId: 'qa-device-a',
    deviceId: 'qa-device-a',
    revision: 17,
    clientUpdatedAt: '2026-10-14T09:00:00.000Z',
  };
  assert.equal(await deviceA.postSnapshot({
    id: 'qa-device-a-request-17',
    createdAt: snapshotA.clientUpdatedAt,
    snapshot: snapshotA,
  }), true);
  const remoteA = await deviceA.obtenerRemoto();
  assert.ok(snapshotCoincideConRemoto(snapshotA, remoteA),
    'the originating device must read back its exact source and revision');

  const deviceB = makeDevice('qa-device-b');
  const initialB = await deviceB.obtenerRemoto();
  assert.ok(snapshotCoincideConRemoto(snapshotA, initialB),
    'a second independent device must read the first device snapshot');

  const snapshotB = {
    sourceId: 'qa-device-b',
    deviceId: 'qa-device-b',
    revision: 18,
    clientUpdatedAt: '2026-10-14T09:01:00.000Z',
  };
  assert.equal(await deviceB.postSnapshot({
    id: 'qa-device-b-request-18',
    createdAt: snapshotB.clientUpdatedAt,
    snapshot: snapshotB,
  }), true);
  const remoteB = await deviceA.obtenerRemoto();
  assert.ok(snapshotCoincideConRemoto(snapshotB, remoteB),
    'the second device must read back its own exact source and revision');
  assert.ok(!snapshotCoincideConRemoto(snapshotA, remoteB),
    'a newer snapshot from another device must not confirm the first device write');
  assert.ok(!snapshotCoincideConRemoto(
    { ...remoteB, revision: 17 },
    { ...remoteB, revision: 18 },
  ), 'a higher remote revision must not falsely confirm a different local revision');
  assert.ok(!snapshotCoincideConRemoto(
    { ...remoteB, sourceId: 'qa-device-a' },
    { ...remoteB, sourceId: 'qa-device-b' },
  ), 'a different source must not falsely confirm the snapshot');

  console.log('PASS: isolated Supabase custom-session POST/GET round-trip across two device contexts');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
