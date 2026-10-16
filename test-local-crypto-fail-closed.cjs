'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const pages = [
  'index.html',
  'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html',
];
const storageScriptId = '<script id="sintergia-storage-crypto-v1">';

function createHarness(source, page, { localEntries = [], sessionEntries = [], failSetKeys = [] } = {}) {
  const start = source.indexOf(storageScriptId);
  const bodyStart = start + storageScriptId.length;
  const end = source.indexOf('</script>', bodyStart);
  assert.ok(start >= 0 && end > bodyStart, `${page}: local crypto script exists`);

  class Storage {
    constructor(entries = [], blockedWrites = []) { this.values = new Map(entries); this.blockedWrites = new Set(blockedWrites); }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) {
      if (this.blockedWrites.has(String(key))) throw new Error('synthetic quota failure');
      this.values.set(String(key), String(value));
    }
    removeItem(key) { this.values.delete(String(key)); }
  }
  const localStorage = new Storage(localEntries, failSetKeys);
  const sessionStorage = new Storage(sessionEntries);
  const window = { localStorage, crypto: webcrypto, __sgIgn() {}, dispatchEvent() {} };
  const sandbox = {
    window,
    localStorage,
    sessionStorage,
    Storage,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
  };
  vm.runInNewContext(source.slice(bodyStart, end), sandbox, { filename: page });
  return { api: window.SintergiaLocalCrypto, localStorage, sessionStorage };
}

function cloneMap(map) { return new Map(Array.from(map.entries(), ([key, value]) => [key, value])); }

async function createLegacyStore(harness) {
  const records = JSON.stringify([{ id: 'fixture-client', name: 'Synthetic local record' }]);
  assert.equal(await harness.api.desbloquear('legacy-password'), true, 'fixture opens with its legacy password');
  harness.localStorage.setItem('sintergia_clientes', records);
  const encrypted = harness.localStorage.values.get('sgx1_sintergia_clientes');
  const oldWraps = harness.localStorage.values.get('sintergia_enc_wraps');
  assert.match(encrypted, /^SGX1\./, 'fixture contains encrypted legacy data');
  assert.ok(oldWraps, 'fixture contains its legacy key envelope');
  harness.api.olvidarClave();
  harness.localStorage.values.set('sintergia_enc_wraps_antiguas', oldWraps);
  harness.localStorage.values.delete('sintergia_enc_wraps');
  return { records, encrypted, oldWraps };
}

async function createStaleCurrentEnvelope(harness, fixture) {
  harness.localStorage.values.delete('sgx1_sintergia_clientes');
  harness.localStorage.values.delete('sintergia_enc_wraps_antiguas');
  assert.equal(await harness.api.desbloquear('SintergiaSE|datos-locales|v1'), true, 'fixture creates the stale app-key envelope left by the old fallback');
  const stale = harness.localStorage.values.get('sintergia_enc_wraps');
  assert.ok(stale, 'fixture contains the stale current envelope');
  harness.api.olvidarClave();
  harness.localStorage.values.set('sgx1_sintergia_clientes', fixture.encrypted);
  harness.localStorage.values.set('sintergia_enc_wraps_antiguas', fixture.oldWraps);
}

(async () => {
  for (const page of pages) {
    const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
    const failed = createHarness(source, page);
    const fixture = await createLegacyStore(failed);
    failed.localStorage.values.set('sintergia_enc_wraps', JSON.stringify({ 'unrelated-key-id': 'untouched-invalid-envelope' }));
    failed.localStorage.values.set('sintergia_security_fixture', 'must-remain-byte-for-byte-identical');
    const beforeFailure = cloneMap(failed.localStorage.values);
    assert.equal(await failed.api.desbloquearApp('wrong-password'), false, `${page}: unknown password fails closed`);
    assert.equal(failed.api.bloqueado(), true, `${page}: failed unlock remains blocked`);
    assert.deepEqual(Array.from(failed.localStorage.values.entries()), Array.from(beforeFailure.entries()), `${page}: failed unlock changes no localStorage bytes`);
    assert.equal(failed.localStorage.values.get('sintergia_enc_wraps_antiguas'), fixture.oldWraps, `${page}: legacy backup envelope remains intact`);
    assert.equal(failed.localStorage.values.get('sgx1_sintergia_clientes'), fixture.encrypted, `${page}: encrypted records remain intact`);

    const staleSessionFixture = createHarness(source, page);
    await createLegacyStore(staleSessionFixture);
    const localBeforeReload = cloneMap(staleSessionFixture.localStorage.values);
    const reloaded = createHarness(source, page, {
      localEntries: Array.from(localBeforeReload.entries()),
      sessionEntries: [['sintergia_enc_k', '11'.repeat(32)]],
    });
    assert.equal(reloaded.api.bloqueado(), true, `${page}: stale session DEK cannot unlock existing ciphertext`);
    assert.equal(reloaded.sessionStorage.getItem('sintergia_enc_k'), null, `${page}: rejected session DEK is discarded`);
    const beforeReloadFailure = cloneMap(reloaded.localStorage.values);
    assert.equal(await reloaded.api.desbloquearApp('wrong-password'), false, `${page}: wrong password after reload stays locked`);
    assert.deepEqual(Array.from(reloaded.localStorage.values.entries()), Array.from(beforeReloadFailure.entries()), `${page}: rejected session key and unlock failure preserve localStorage`);

    const recovered = createHarness(source, page);
    const legacy = await createLegacyStore(recovered);
    await createStaleCurrentEnvelope(recovered, legacy);
    const backupBefore = recovered.localStorage.values.get('sintergia_enc_wraps_antiguas');
    assert.equal(await recovered.api.desbloquearApp('legacy-password'), true, `${page}: valid legacy envelope still opens`);
    assert.equal(recovered.api.bloqueado(), false, `${page}: legacy key activates the local store`);
    assert.equal(recovered.localStorage.getItem('sintergia_clientes'), legacy.records, `${page}: decrypted legacy record is preserved`);
    assert.equal(recovered.localStorage.values.get('sintergia_enc_wraps_antiguas'), backupBefore, `${page}: recovery keeps the original backup envelope`);
    recovered.api.olvidarClave();
    assert.equal(await recovered.api.desbloquearApp('SintergiaSE|datos-locales|v1'), true, `${page}: repaired app-key envelope opens on the next session`);
    assert.equal(recovered.localStorage.getItem('sintergia_clientes'), legacy.records, `${page}: the app-key envelope still reaches the original record`);

    const plaintextFixture = createHarness(source, page);
    assert.equal(await plaintextFixture.api.desbloquear('migration-password'), true, `${page}: migration fixture creates a valid DEK envelope`);
    const migrationSessionDek = plaintextFixture.sessionStorage.getItem('sintergia_enc_k');
    plaintextFixture.api.olvidarClave();
    const plainRecord = JSON.stringify([{ id: 'synthetic-plaintext', name: 'Must survive failed migration' }]);
    plaintextFixture.localStorage.values.set('sintergia_clientes', plainRecord);
    const migrationEntries = Array.from(plaintextFixture.localStorage.values.entries());
    const successfulMigration = createHarness(source, page, { localEntries: migrationEntries });
    assert.equal(await successfulMigration.api.desbloquearApp('migration-password'), true, `${page}: successful cleartext migration unlocks`);
    assert.equal(successfulMigration.localStorage.getItem('sintergia_clientes'), plainRecord, `${page}: successful migration preserves the original record`);
    assert.equal(successfulMigration.localStorage.values.has('sintergia_clientes'), false, `${page}: cleartext is removed only after verified encryption`);
    assert.match(successfulMigration.localStorage.values.get('sgx1_sintergia_clientes'), /^SGX1\./, `${page}: successful migration persists encrypted data`);

    const blockedMigration = createHarness(source, page, {
      localEntries: migrationEntries,
      failSetKeys: ['sgx1_sintergia_clientes'],
    });
    const beforeMigrationFailure = cloneMap(blockedMigration.localStorage.values);
    assert.equal(await blockedMigration.api.desbloquearApp('migration-password'), false, `${page}: failed cleartext migration blocks unlock`);
    assert.equal(blockedMigration.api.bloqueado(), true, `${page}: failed cleartext migration leaves the vault locked`);
    assert.deepEqual(Array.from(blockedMigration.localStorage.values.entries()), Array.from(beforeMigrationFailure.entries()), `${page}: quota failure preserves every original localStorage byte`);
    assert.equal(blockedMigration.localStorage.values.get('sintergia_clientes'), plainRecord, `${page}: original plaintext record remains available for recovery`);
    assert.equal(blockedMigration.localStorage.values.has('sgx1_sintergia_clientes'), false, `${page}: incomplete encrypted record is not accepted`);
    assert.equal(blockedMigration.sessionStorage.getItem('sintergia_enc_k'), null, `${page}: failed migration does not persist an active DEK`);

    const plainParts = JSON.stringify([{ id: 'synthetic-part', name: 'Must survive interrupted migration' }]);
    const partialMigrationEntries = migrationEntries.concat([['sintergia_partes', plainParts]]);
    const partialMigration = createHarness(source, page, {
      localEntries: partialMigrationEntries,
      failSetKeys: ['sgx1_sintergia_partes'],
    });
    assert.equal(await partialMigration.api.desbloquearApp('migration-password'), false, `${page}: later quota failure aborts a partially migrated store`);
    assert.equal(partialMigration.api.bloqueado(), true, `${page}: partially migrated store remains locked`);
    assert.equal(partialMigration.localStorage.values.has('sintergia_clientes'), false, `${page}: already migrated plaintext is removed`);
    assert.match(partialMigration.localStorage.values.get('sgx1_sintergia_clientes'), /^SGX1\./, `${page}: already migrated ciphertext is retained`);
    assert.equal(partialMigration.localStorage.values.get('sintergia_partes'), plainParts, `${page}: failed record remains recoverable in its original form`);
    assert.equal(partialMigration.sessionStorage.getItem('sintergia_enc_k'), null, `${page}: partial migration does not persist an active DEK`);

    const resumedMigration = createHarness(source, page, { localEntries: Array.from(partialMigration.localStorage.values.entries()) });
    assert.equal(await resumedMigration.api.desbloquearApp('migration-password'), true, `${page}: a partial migration resumes after quota recovers`);
    assert.equal(resumedMigration.localStorage.getItem('sintergia_clientes'), plainRecord, `${page}: resumed migration preserves the first record`);
    assert.equal(resumedMigration.localStorage.getItem('sintergia_partes'), plainParts, `${page}: resumed migration preserves the remaining record`);
    assert.equal(resumedMigration.localStorage.values.has('sintergia_partes'), false, `${page}: remaining plaintext is removed after verification`);

    const blockedReloadMigration = createHarness(source, page, {
      localEntries: migrationEntries,
      sessionEntries: [['sintergia_enc_k', migrationSessionDek]],
      failSetKeys: ['sgx1_sintergia_clientes'],
    });
    assert.equal(blockedReloadMigration.api.bloqueado(), true, `${page}: reload cannot trust a session key before migration completes`);
    assert.equal(blockedReloadMigration.sessionStorage.getItem('sintergia_enc_k'), null, `${page}: failed startup migration discards the session DEK`);
    assert.equal(blockedReloadMigration.localStorage.values.get('sintergia_clientes'), plainRecord, `${page}: failed startup migration preserves the original record`);

    const corrupted = createHarness(source, page);
    await createLegacyStore(corrupted);
    corrupted.localStorage.values.set('sgx1_sintergia_clientes', 'SGX1.corrupted.ciphertext');
    const beforeCorruptUnlock = cloneMap(corrupted.localStorage.values);
    assert.equal(await corrupted.api.desbloquearApp('legacy-password'), false, `${page}: corrupted ciphertext is rejected`);
    assert.equal(corrupted.api.bloqueado(), true, `${page}: corrupted ciphertext cannot activate an empty store`);
    assert.deepEqual(Array.from(corrupted.localStorage.values.entries()), Array.from(beforeCorruptUnlock.entries()), `${page}: corrupted-data rejection changes no localStorage bytes`);
  }
  console.log(`PASS: fail-closed unlock, legacy recovery, verified cleartext migration, quota-failure preservation, and ciphertext rejection across ${pages.length} HTML entrypoints`);
})().catch(error => { console.error(error); process.exitCode = 1; });
