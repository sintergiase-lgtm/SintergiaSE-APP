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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}()`);
  const end = source.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, `${name} handler exists`);
  return source.slice(start, end);
}

for (const page of pages) {
  const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const rejectHandler = extractFunction(source, 'rechazarReciboFacturaActual');

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

    vm.runInNewContext(`${rejectHandler}\nrechazarReciboFacturaActual();`, sandbox);

    assert.equal(invoice.estado, scenario.expected, `${page}: restores safe prior state (${scenario.prior || 'missing'})`);
    assert.equal(Object.hasOwn(invoice, 'estadoAntesDeRecibo'), false, `${page}: clears previous state marker`);
    assert.equal(Object.hasOwn(invoice, 'reciboValidadoAt'), false, `${page}: removes stale validation marker`);
    assert.ok(Number.isFinite(Date.parse(invoice.reciboRechazadoAt)), `${page}: records rejection time`);
    assert.equal(saves, 1, `${page}: persists rejection`);
    assert.equal(renders, 1, `${page}: refreshes invoice history`);
    assert.equal(closes, 1, `${page}: closes receipt preview`);
    assert.match(toast, /estado de factura:/i, `${page}: explains current invoice state`);
    assert.ok(toast.includes(scenario.expected), `${page}: toast matches resulting invoice state`);
  }

  const invoice = {
    estado: 'Cobrado pendiente validacion',
    estadoAntesDeRecibo: 'Facturado',
    reciboRechazadoAt: 'stale-rejection',
  };
  let saves = 0;
  let invoiceRenders = 0;
  let partsRenders = 0;
  let pendingRenders = 0;
  let closes = 0;
  let cascade = null;
  let toast = '';
  const sandbox = {
    appState: { facturaActualPrevisualizandoIdx: 0, facturas: [invoice] },
    guardarEstadoStorage() { saves += 1; },
    renderizarHistorialFacturas() { invoiceRenders += 1; },
    renderizarHistorialPartes() { partsRenders += 1; },
    renderizarPendientes() { pendingRenders += 1; },
    marcarFacturaCobradaEnCascada(...args) { cascade = args; },
    cerrarModalReciboPreview() { closes += 1; },
    mostrarToast(message) { toast = message; },
    Date,
  };
  const validateHandler = extractFunction(source, 'validarReciboFacturaActual');
  vm.runInNewContext(`${validateHandler}\nvalidarReciboFacturaActual();`, sandbox);
  assert.equal(invoice.estado, 'Cobrado', `${page}: manual approval marks invoice paid`);
  assert.equal(Object.hasOwn(invoice, 'estadoAntesDeRecibo'), false, `${page}: approval clears old prior-state marker`);
  assert.equal(Object.hasOwn(invoice, 'reciboRechazadoAt'), false, `${page}: approval clears stale rejection marker`);
  assert.ok(Number.isFinite(Date.parse(invoice.reciboValidadoAt)), `${page}: approval records validation time`);
  assert.deepEqual(cascade, [0, true], `${page}: approval updates linked parts`);
  assert.equal(saves, 1, `${page}: persists approval`);
  assert.equal(invoiceRenders, 1, `${page}: refreshes invoices`);
  assert.equal(partsRenders, 1, `${page}: refreshes linked parts`);
  assert.equal(pendingRenders, 1, `${page}: refreshes pending items`);
  assert.equal(closes, 1, `${page}: closes preview after approval`);
  assert.match(toast, /cobrado/i, `${page}: reports successful approval`);
}

console.log(`PASS: ${pages.length * cases.length} rejection scenarios and ${pages.length} approval scenarios across both pages`);

