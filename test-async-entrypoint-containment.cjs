'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function verify(file) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');

  const parkedStart = html.indexOf('    async function iniciarTrabajoDesdeAvisoAparcado(idx) {');
  const parkedEnd = html.indexOf('\n    function iniciarTrabajoPendiente(idx)', parkedStart);
  assert.ok(parkedStart >= 0 && parkedEnd > parkedStart, `${file}: parked-work function boundaries must exist`);
  const messages = [];
  const errors = [];
  let timerCallback;
  const parkedContext = vm.createContext({
    appState: { pendientes: [{ parteId: 'P-1' }], partes: [{ idDoc: 'P-1' }] },
    document: { querySelector: () => ({ click() {} }) },
    editarParte() {},
    setTimeout(callback) { timerCallback = callback; },
    iniciarTrabajo: async () => { throw new Error('GPS unavailable'); },
    guardarEstadoStorage() { throw new Error('must not persist failed start'); },
    renderizarPendientes() { throw new Error('must not render failed start'); },
    mostrarToast: message => messages.push(message),
    window: { __sgIgn: error => errors.push(error) }
  });
  vm.runInContext(`${html.slice(parkedStart, parkedEnd)}\nglobalThis.__startParked = iniciarTrabajoDesdeAvisoAparcado;`, parkedContext);
  await parkedContext.__startParked(0);
  assert.equal(typeof timerCallback, 'function', `${file}: parked-work start should schedule its GPS action`);
  await assert.doesNotReject(timerCallback(), `${file}: GPS rejection from a timer must be contained`);
  assert.equal(errors.length, 1, `${file}: failed parked-work GPS start must be reported`);
  assert.match(messages[0] || '', /No se pudo iniciar el trabajo/, `${file}: failed start must show a recoverable message`);

  const syncStart = html.indexOf('RutasIA.sincronizarRespuestas=async function(manual){');
  const syncEnd = html.indexOf('\n};\nRutasIA.__syncReset', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, `${file}: appointment-sync function boundaries must exist`);
  const syncErrors = [];
  const syncMessages = [];
  const syncContext = vm.createContext({
    RutasIA: {},
    state: { citas: null },
    syncBusy: false,
    syncProximo: 0,
    SYNC_MS: 1000,
    Date,
    navigator: { onLine: true },
    window: { __sgIgn: error => syncErrors.push(error) },
    toast: message => syncMessages.push(message)
  });
  vm.runInContext(`${html.slice(syncStart, syncEnd + 3)}\nglobalThis.__sync = RutasIA.sincronizarRespuestas;`, syncContext);
  await assert.doesNotReject(syncContext.__sync(true), `${file}: unexpected sync state errors must not reject timer/UI callers`);
  assert.equal(syncErrors.length, 1, `${file}: unexpected sync failures must reach diagnostics`);
  assert.match(syncMessages[0] || '', /No se pudo completar la sincronización/, `${file}: manual sync failure must be visible`);
  assert.equal(syncContext.syncBusy, false, `${file}: a failed sync must release the busy lock`);
  console.log(`PASS: ${file} contains parked-work and appointment-sync failures`);
}

(async () => {
  await verify('index.html');
  await verify('SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
