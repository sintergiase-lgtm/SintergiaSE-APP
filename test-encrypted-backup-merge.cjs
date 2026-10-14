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

function importerScenario(page, source, { confirmResult = true, applyResult = true } = {}) {
  const prepared = [];
  const audits = [];
  const alerts = [];
  const snapshot = { version: 5, clientes: [{ id: 'backup-client' }], partes: [], facturas: [], horario: null, compras: [] };
  const payload = { format: 'SINTERGIASE-BACKUP', kdf: { salt: 'salt' }, cipher: { iv: 'iv', data: 'ciphertext' } };
  const sandbox = {
    window: { aplicarSnapshotSincronizacion(value) { prepared.push(value); return applyResult; } },
    localStorage: { getItem(key) { return key === 'sintergia_sync_revision' ? '47' : null; } },
    sessionStorage: { getItem(key) { return key === 'sintergia_device_id' ? 'device-current' : null; } },
    crypto: { subtle: { async decrypt() { return new TextEncoder().encode(JSON.stringify(snapshot)).buffer; } } },
    TextEncoder,
    TextDecoder,
    JSON,
    Number,
    Array,
    Object,
    Date,
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
  const importerStart = source.indexOf('async function importarCifrado(');
  const importerEnd = source.indexOf('\n', importerStart);
  assert.ok(importerStart >= 0 && importerEnd > importerStart, `${page}: async importer exists`);
  const importer = source.slice(importerStart, importerEnd);
  assert.match(importer, /fusionarCopiaImportada\(snap\)/, `${page}: importer delegates to sync merge`);
  assert.match(importer, /if\(!confirm\(/, `${page}: importer confirms documented merge semantics`);
  return vm.runInNewContext(`${helpers}\n${importer}\nimportarCifrado(ev);`, sandbox).then(() => ({ prepared, audits, alerts, snapshot }));
}

(async () => {
  for (const page of pages) {
    const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
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
    assert.equal(successful.prepared.length, 1, `${page}: applies the decrypted snapshot once`);
    assert.equal(successful.prepared[0].revision, 47, `${page}: importer passes the normalized revision`);
    assert.equal(successful.prepared[0].sourceId, 'device-current', `${page}: importer passes the local source ID`);
    assert.equal(Object.hasOwn(successful.prepared[0], 'horario'), false, `${page}: importer omits a null schedule`);
    assert.ok(successful.alerts.some(message => /Copia fusionada correctamente/i.test(message)), `${page}: reports success only after application`);

    const rejected = await importerScenario(page, source, { applyResult: false });
    assert.equal(rejected.prepared.length, 1, `${page}: detects failed snapshot application`);
    assert.ok(rejected.alerts.some(message => /No se pudo restaurar la copia/i.test(message)), `${page}: reports failed application`);
    assert.equal(rejected.alerts.some(message => /Copia fusionada correctamente/i.test(message)), false, `${page}: does not claim success after failure`);

    const cancelled = await importerScenario(page, source, { confirmResult: false });
    assert.equal(cancelled.prepared.length, 0, `${page}: cancellation does not change local data`);
    assert.equal(cancelled.alerts.length, 0, `${page}: cancellation does not show a success message`);
  }
  console.log(`PASS: encrypted backup merge import and failure handling across ${pages.length} pages`);
})().catch(error => { console.error(error); process.exitCode = 1; });
