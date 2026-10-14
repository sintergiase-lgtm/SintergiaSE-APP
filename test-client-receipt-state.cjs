'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = [
  'index.html',
  'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html',
];
const cases = [
  { prior: 'Facturado', expected: 'Facturado' },
  { prior: 'Enviado', expected: 'Enviado' },
  { prior: undefined, expected: 'Pendiente' },
  { prior: 'Cobrado', expected: 'Pendiente' },
  { prior: 'Cobrado pendiente validacion', expected: 'Pendiente' },
  { prior: 'Anulado', expected: 'Pendiente' },
  { prior: 'Anulada', expected: 'Pendiente' },
  { prior: 'Rectificativa', expected: 'Pendiente' },
];

function extractRejectFunction(source) {
  const start = source.indexOf('function rechazarReciboFacturaActual()');
  const end = source.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, 'receipt rejection handler exists');
  return source.slice(start, end);
}

for (const page of pages) {
  const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const handler = extractRejectFunction(source);

  for (const scenario of cases) {
    const invoice = {
      estado: 'Cobrado pendiente validacion',
      estadoAntesDeRecibo: scenario.prior,
      reciboValidadoAt: 'stale-validation',
    };
    let saves = 0;
    let renders = 0;
    let closes = 0;
    let toast = '';
    const sandbox = {
      appState: { facturaActualPrevisualizandoIdx: 0, facturas: [invoice] },
      guardarEstadoStorage() { saves += 1; },
      renderizarHistorialFacturas() { renders += 1; },
      cerrarModalReciboPreview() { closes += 1; },
      mostrarToast(message) { toast = message; },
      Date,
    };

    vm.runInNewContext(`${handler}\nrechazarReciboFacturaActual();`, sandbox);

    assert.equal(invoice.estado, scenario.expected, `${page}: restores safe prior state (${scenario.prior || 'missing'})`);
    assert.equal(Object.hasOwn(invoice, 'estadoAntesDeRecibo'), false, `${page}: clears previous state marker`);
    assert.equal(Object.hasOwn(invoice, 'reciboValidadoAt'), false, `${page}: removes stale validation marker`);
    assert.ok(Number.isFinite(Date.parse(invoice.reciboRechazadoAt)), `${page}: records rejection time`);
    assert.equal(saves, 1, `${page}: persists rejection`);
    assert.equal(renders, 1, `${page}: refreshes invoice history`);
    assert.equal(closes, 1, `${page}: closes receipt preview`);
    assert.match(toast, /estado anterior/i, `${page}: reports restored state`);
  }
}

console.log(`PASS: ${pages.length * cases.length * 9} client receipt-state assertions run against both pages`);

