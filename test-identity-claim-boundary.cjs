'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = [
  'index.html',
  'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html',
];

async function runPage(page) {
  const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const helperStart = source.indexOf('function normalizarDNI(v)');
  const helperEnd = source.indexOf('function mostrarModo(tipo)', helperStart);
  const handlerStart = source.indexOf('async function procesarIdentidad(ev)');
  const handlerEnd = source.indexOf('/* --- PASO 3: firma obligatoria --- */', handlerStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, `${page}: identity helpers exist`);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, `${page}: identity handler exists`);

  assert.match(source, /esta comprobación no confirma la identidad contra un registro oficial/i);
  assert.doesNotMatch(source, /para asegurar que corresponden a una persona real/i);
  assert.doesNotMatch(source, /nombre y apellidos reales/i);
  assert.match(source, /verified:\s*false,\s*identityFormatValidated:\s*true/);
  assert.match(source, /tecnicoIdentidadVerificada:\s*t\.verified\s*===\s*true/);

  const fields = {
    'sintergia-access-name': { value: 'José de Prueba' },
    'sintergia-access-dni': { value: '12345678Z' },
    'sintergia-access-sse': { value: 'synthetic-password' },
  };
  const savedSession = new Map();
  const sandbox = {
    document: { getElementById: id => fields[id] || null },
    window: {},
    sessionStorage: { setItem: (key, value) => savedSession.set(key, value) },
    errorId: { textContent: '' },
    passPendiente: 'synthetic-password',
    modoPendiente: 'tecnico',
    finalizarAcceso: async mode => { sandbox.finalizedMode = mode; },
  };
  const code = `${source.slice(helperStart, helperEnd)}\n${source.slice(handlerStart, handlerEnd)}\nprocesarIdentidad({preventDefault(){}});`;
  await vm.runInNewContext(code, sandbox);

  assert.equal(sandbox.errorId.textContent, '');
  assert.equal(sandbox.finalizedMode, 'tecnico');
  assert.equal(sandbox.window.SintergiaTechnician.verified, false);
  assert.equal(sandbox.window.SintergiaTechnician.identityFormatValidated, true);
  assert.equal(sandbox.window.SintergiaTechnician.nombre, 'José de Prueba');
  assert.equal(sandbox.window.SintergiaTechnician.dni, '12345678Z');
  assert.ok(savedSession.has('sintergia_technician'));
}

(async () => {
  for (const page of pages) await runPage(page);
  console.log(`PASS: identity claims stay limited to format validation (${pages.length} pages)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
