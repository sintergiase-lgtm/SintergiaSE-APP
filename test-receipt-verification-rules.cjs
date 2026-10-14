const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'verify-receipt-v14-candidate.ts'), 'utf8');
function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\b[\\s\\S]*?\\n}\\n`));
  assert.ok(match, `Could not find ${name} in the actual candidate source`);
  return match[0];
}
const helperSource = [
  extractFunction('normalizeReference'),
  extractFunction('finiteNonNegative'),
  extractFunction('expectedAmountFromInvoice'),
  extractFunction('receiptVerificationStatus'),
  extractFunction('evaluateModelVerification'),
  'globalThis.evaluateModelVerification = evaluateModelVerification; globalThis.expectedAmountFromInvoice = expectedAmountFromInvoice; globalThis.receiptVerificationStatus = receiptVerificationStatus;'
].join('\n');
const compiled = helperSource
  .replace(/: unknown/g, '')
  .replace(/: number \| null/g, '')
  .replace(/: number/g, '')
  .replace(/: 'verified' \| 'rejected'/g, '')
  .replace(/: boolean/g, '')
  .replace(/: string/g, '')
  .replace(/: any/g, '');
const sandbox = {};
vm.runInNewContext(compiled, sandbox);
const evaluate = sandbox.evaluateModelVerification;
const good = { valido: true, referencia: 'FAC-2026-001', importe: 123.45, referenciaCoincide: true, importeCoincide: true };
assert.equal(evaluate(good, 'FAC-2026-001', 123.45).valid, true, 'valid exact match is accepted');
assert.equal(evaluate({ ...good, referenciaCoincide: undefined }, 'FAC-2026-001', 123.45).valid, false, 'missing reference flag fails closed');
assert.equal(evaluate({ ...good, importeCoincide: undefined }, 'FAC-2026-001', 123.45).valid, false, 'missing amount flag fails closed');
assert.equal(evaluate({ ...good, referencia: 'FAC-OTHER' }, 'FAC-2026-001', 123.45).valid, false, 'wrong reference fails');
assert.equal(evaluate({ ...good, importe: 123.47 }, 'FAC-2026-001', 123.45).valid, false, 'amount difference beyond tolerance fails');
assert.equal(evaluate({ ...good, importe: -1 }, 'FAC-2026-001', 123.45).valid, false, 'negative amount fails');
assert.equal(evaluate({ ...good, valido: false }, 'FAC-2026-001', 123.45).valid, false, 'explicit rejection fails');
assert.equal(evaluate(null, 'FAC-2026-001', 123.45).valid, false, 'malformed output fails');
assert.equal(evaluate({ ...good, referencia: '' }, 'FAC-2026-001', 123.45).valid, false, 'empty reference fails');
assert.equal(sandbox.expectedAmountFromInvoice('123.45'), 123.45, 'registered invoice amount is accepted');
assert.equal(sandbox.expectedAmountFromInvoice(null), null, 'missing registered amount stays missing');
assert.equal(sandbox.expectedAmountFromInvoice(-1), null, 'negative registered amount is rejected');
assert.equal(sandbox.expectedAmountFromInvoice('not-an-amount'), null, 'malformed registered amount is rejected');
assert.equal(sandbox.receiptVerificationStatus(true), 'verified', 'successful verification status matches its result');
assert.equal(sandbox.receiptVerificationStatus(false), 'rejected', 'failed verification status is rejected');
assert.match(source, /const expectedAmount = expectedAmountFromInvoice\(row\.importe\)/, 'route uses only the registered invoice amount');
assert.doesNotMatch(source, /finiteNonNegative\(body\.importe\)/, 'caller-supplied amount cannot become the expected amount');
assert.match(source, /status: receiptVerificationStatus\(valid\), valido: valid/, 'stored status is derived from the verification result');
assert.doesNotMatch(source, /status:\s*'verified'\s*,\s*valido:\s*valid/, 'rejected results are not stored as verified');
assert.match(source, /if \(!expectedReference \|\| expectedAmount === null\)/, 'missing registered amount fails closed');
console.log('PASS: 20 receipt-verification assertions run against candidate code');

