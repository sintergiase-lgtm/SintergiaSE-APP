'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const offlineScript = html.match(/<script id="sintergia-offline-first-v3">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(offlineScript, `${file}: offline-first script must exist`);

  const apiStart = offlineScript.indexOf('function backendApiOrigins(){');
  const apiEnd = offlineScript.indexOf('\n  function toast', apiStart);
  assert.ok(apiStart >= 0 && apiEnd > apiStart, `${file}: backend route classifiers must exist`);
  const apiContext = {
    URL,
    location: { origin: 'https://app.example', href: 'https://app.example/index.html' },
    window: { SINTERGIA_BACKEND: { sync: {
      snapshotEndpoint: 'https://backend.example/functions/v1/realtime-snapshot',
      operationsEndpoint: 'https://backend.example/functions/v1/sync-operations'
    } } }
  };
  vm.createContext(apiContext);
  vm.runInContext(`${apiStart >= 0 ? 'const CFG=window.SINTERGIA_BACKEND||{};' : ''}${offlineScript.slice(apiStart, apiEnd)}\nglobalThis.__sameOriginApi=sameOriginApi;globalThis.__excluded=excluded;`, apiContext);
  assert.equal(apiContext.__sameOriginApi('https://backend.example/functions/v1/sync-operations'), true,
    `${file}: configured HTTPS backend functions must be recognized`);
  assert.equal(apiContext.__sameOriginApi('/functions/v1/local-action'), true,
    `${file}: same-origin function routes remain supported`);
  assert.equal(apiContext.__sameOriginApi('https://evil.example/functions/v1/sync-operations'), false,
    `${file}: unconfigured function hosts must not be treated as application APIs`);
  assert.equal(apiContext.__excluded('https://backend.example/functions/v1/realtime-snapshot'), true,
    `${file}: snapshot endpoint must bypass the offline API interception queue`);
  assert.equal(apiContext.__excluded('/functions/v1/health'), true,
    `${file}: health checks must bypass offline API interception`);
  assert.equal(apiContext.__excluded('/functions/v1/user-action'), false,
    `${file}: ordinary function calls remain eligible for offline handling`);

  const putQMatch = offlineScript.match(/function putQ\(k,q\)\{[\s\S]*?\n  \}/);
  assert.ok(putQMatch, `${file}: queue persistence helper must exist`);
  let stored = null;
  const writeContext = {
    MAX_ITEMS: 1000,
    MAX_OPERATIONS: 5000,
    LS: { operations: 'operations' },
    isCriticalQueue: () => true,
    write: (_key, value) => { stored = structuredClone(value); return true; },
    read: (_key, fallback) => stored === null ? fallback : structuredClone(stored),
    toast() {}
  };
  vm.createContext(writeContext);
  vm.runInContext(`${putQMatch[0]}\nglobalThis.__putQ=putQ;`, writeContext);
  for (const [key, length] of [['api', 1001], ['operations', 5001], ['changes', 1001]]) {
    stored = null;
    assert.equal(writeContext.__putQ(key, Array.from({ length }, (_, id) => ({ id }))), true);
    assert.equal(stored.length, length, `${file}: ${key} must not silently discard unacknowledged items over its warning threshold`);
  }
  console.log(`PASS: ${file} API route classification and lossless queue size thresholds`);
}
