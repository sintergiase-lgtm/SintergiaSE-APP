const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source = fs.readFileSync('/mnt/data/verify-receipt-v14-candidate.ts', 'utf8');
function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\b[\\s\\S]*?\\n}\\n`));
  assert.ok(match, `Could not find ${name} in the actual candidate source`);
  return match[0];
}
const helperSource = [
  extractFunction('normalizeReference'),
  extractFunction('finiteNonNegative'),
  extractFunction('evaluateModelVerification'),
  'globalThis.evaluateModelVerification = evaluateModelVerification;'
].join('\n');
const compiled = ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
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
console.log('PASS: 9 tests run against helpers extracted from verify-receipt-v14-candidate.ts');
