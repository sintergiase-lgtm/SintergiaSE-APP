'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html'];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, `${name} exists`);
  return source.slice(start, end);
}

function extractSyncApplier(source) {
  const start = source.indexOf('window.aplicarSnapshotSincronizacion=function(snapshot)');
  const end = source.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, 'sync snapshot applier exists');
  return source.slice(start, end);
}

function importerScenario(page, source, { confirmResult = true, saveResult = true } = {}) {
  const audits = [];
  const alerts = [];
  const snapshot = { version: 5, clientes: [{ id: 'backup-client' }], partes: [], facturas: [], horario: null, compras: [] };
  const payload = { format: 'SINTERGIASE-BACKUP', kdf: { salt: 'salt' }, cipher: { iv: 'iv', data: 'ciphertext' } };
  const persisted = new Map([['sintergia_sync_revision', '47']]);
  const appState = { clientes: [], partes: [], facturas: [], pendientes: [], stock: [], stockListas: [], compras: [], partCounter: 1, facCounter: 1 };
  const window = {
    appState,
    guardarEstadoStorage() { return saveResult; },
    renderizarTodo() {},
    __sgIgn() {},
  };
  const sandbox = {
    window,
    localStorage: {
      getItem(key) { return persisted.has(key) ? persisted.get(key) : null; },
      setItem(key, value) { persisted.set(key, String(value)); },
    },
    sessionStorage: { getItem(key) { return key === 'sintergia_device_id' ? 'device-current' : null; } },
    crypto: { subtle: { async decrypt() { return new TextEncoder().encode(JSON.stringify(snapshot)).buffer; } } },
    TextEncoder,
    TextDecoder,
    JSON,
    Number,
    Array,
    Object,
    Date,
    Map,
    String,
    tombstoneBlocksEntity() { return false; },
    prompt() { return 'local-test-password'; },
    confirm() { return confirmResult; },
    alert(message) { alerts.push(String(message)); },
    audit(...args) { audits.push(args); },
    renderStatus() {},
    async derive() { return {}; },
    unb64() { return new Uint8Array([1]); },
    ev: { target: { files: [{ async text() { return JSON.stringify(payload); } }], value: 'selected' } },
  };
  const helpers = [extractFunction(source, 'prepararSnapshotImportacion'), extractFunction(source, 'fusionarCopiaImportada')].join('\n');
  const mergeArrays = extractFunction(source, 'mergeEntityArrays');
  const syncApplier = extractSyncApplier(source);
  const importerStart = source.indexOf('async function importarCifrado(');
  const importerEnd = source.indexOf('\n', importerStart);
  assert.ok(importerStart >= 0 && importerEnd > importerStart, `${page}: async importer exists`);
  const importer = source.slice(importerStart, importerEnd);
  assert.match(importer, /fusionarCopiaImportada\(snap\)/, `${page}: importer delegates to sync merge`);
  assert.match(importer, /if\(!confirm\(/, `${page}: importer confirms documented merge semantics`);
  return vm.runInNewContext(`${mergeArrays}\n${syncApplier}\n${helpers}\n${importer}\nimportarCifrado(ev);`, sandbox).then(() => ({ alerts, audits, appState, persisted }));
}

(async () => {
  for (const page of pages) {
    const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
    assert.match(source, /window\.aplicarSnapshotSincronizacion\(snap\)!==true\)return false/, `${page}: local persistence failure reaches the caller`);
    assert.match(source, /if\(!applied\)ultimoHash='';syncToast\(applied\?/, `${page}: periodic sync reports failure and retries later`);
    const helpers = [extractFunction(source, 'prepararSnapshotImportacion'), extractFunction(source, 'fusionarCopiaImportada')].join('\n');
    const preparedSandbox = {
      window: { aplicarSnapshotSincronizacion(value) { this.value = value; return true; } },
      localStorage: { getItem() { return '47'; } },
      sessionStorage: { getItem() { return 'device-current'; } },
      Number,
      Array,
      Object,
    };
    vm.runInNewContext(`${helpers}\nglobalThis.preparar = prepararSnapshotImportacion; globalThis.fusionar = fusionarCopiaImportada;`, preparedSandbox);
    const prepared = preparedSandbox.preparar({ clientes: [{ id: 'from-backup' }], horario: null });
    assert.equal(prepared.revision, 47, `${page}: uses current sync revision to avoid stale rejection`);
    assert.equal(prepared.sourceId, 'device-current', `${page}: identifies this importing device`);
    assert.equal(Object.hasOwn(prepared, 'horario'), false, `${page}: empty backup schedule cannot erase local schedule`);
    assert.deepEqual(JSON.parse(JSON.stringify(prepared.clientes)), [{ id: 'from-backup' }], `${page}: retains backup records for merge`);

    const successful = await importerScenario(page, source);
    assert.deepEqual(JSON.parse(JSON.stringify(successful.appState.clientes)), [{ id: 'backup-client' }], `${page}: persists merged backup records`);
    assert.ok(successful.alerts.some(message => /Copia fusionada correctamente/i.test(message)), `${page}: reports success only after persistence succeeds`);

    const rejected = await importerScenario(page, source, { saveResult: false });
    assert.ok(rejected.alerts.some(message => /No se pudo restaurar la copia/i.test(message)), `${page}: reports failed persistence`);
    assert.equal(rejected.alerts.some(message => /Copia fusionada correctamente/i.test(message)), false, `${page}: does not claim success after a storage failure`);

    const cancelled = await importerScenario(page, source, { confirmResult: false });
    assert.deepEqual(JSON.parse(JSON.stringify(cancelled.appState.clientes)), [], `${page}: cancellation does not change data`);
    assert.equal(cancelled.alerts.length, 0, `${page}: cancellation does not show a success message`);
  }
  console.log(`PASS: encrypted backup import, durability result, and failure handling across ${pages.length} pages`);
})().catch(error => { console.error(error); process.exitCode = 1; });
