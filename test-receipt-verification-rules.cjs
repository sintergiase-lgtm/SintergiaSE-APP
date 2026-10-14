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
  "const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);",
  extractFunction('normalizeReference'),
  extractFunction('finiteNonNegative'),
  extractFunction('expectedAmountFromInvoice'),
  extractFunction('receiptVerificationStatus'),
  extractFunction('normalizeReceiptContentType'),
  extractFunction('receiptFileExtension'),
  extractFunction('receiptObjectPath'),
  extractFunction('receiptEvidenceMetadata'),
  extractFunction('evaluateModelVerification'),
  'globalThis.evaluateModelVerification = evaluateModelVerification; globalThis.expectedAmountFromInvoice = expectedAmountFromInvoice; globalThis.receiptVerificationStatus = receiptVerificationStatus; globalThis.normalizeReceiptContentType = normalizeReceiptContentType; globalThis.receiptObjectPath = receiptObjectPath; globalThis.receiptEvidenceMetadata = receiptEvidenceMetadata;'
].join('\n');
const compiled = helperSource
  .replace(/: unknown/g, '')
  .replace(/: number \| null/g, '')
  .replace(/: number/g, '')
  .replace(/: string \| null/g, '')
  .replace(/: Record<string, string>/g, '')
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
assert.equal(sandbox.normalizeReceiptContentType('image/jpeg', 'foto.jpg'), 'image/jpeg', 'supported image type is retained');
assert.equal(sandbox.normalizeReceiptContentType('application/pdf', 'factura.pdf'), 'application/pdf', 'PDF is allowed for storage');
assert.equal(sandbox.normalizeReceiptContentType('', 'factura.pdf'), 'application/pdf', 'missing MIME type falls back to a safe extension');
assert.equal(sandbox.normalizeReceiptContentType('image/svg+xml', 'recibo.svg'), null, 'active SVG content is rejected');
const objectPath = sandbox.receiptObjectPath('../token', 'a'.repeat(64), 'application/pdf');
assert.match(objectPath, /^receipts\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.pdf$/, 'storage path sanitizes token and uses the file digest');
assert.equal(sandbox.receiptObjectPath('token', 'not-a-digest', 'image/jpeg'), null, 'invalid digest cannot form a storage path');
const evidence = sandbox.receiptEvidenceMetadata(objectPath, 'a'.repeat(64), 'application/pdf', 123, 'recibo.pdf');
assert.equal(evidence.bucket, 'sintergia-docs', 'evidence uses the configured Storage bucket name');
assert.equal(evidence.sha256, 'a'.repeat(64), 'stored evidence includes a digest');
assert.equal(Object.hasOwn(evidence, 'file_base64'), false, 'evidence metadata never embeds the binary');
assert.match(source, /storage\.storage\.from\('sintergia-docs'\)\.upload\(storagePath, fileBytes/, 'route uploads the binary to Storage');
assert.doesNotMatch(source, /file_base64:\s*rawBase64/, 'JSONB metadata does not receive the Base64 file');
assert.match(source, /- 'file_base64'/, 'legacy Base64 field is removed on update');
assert.match(source, /jsonb_typeof\(payload\)\s*=\s*'object'\s+then payload else '\{\}'::jsonb end/i, 'legacy scalar JSONB payload is normalized before object merge');
assert.match(source, /MAX_FILE_BYTES = 8 \* 1024 \* 1024/, 'decoded file size remains capped at the client limit');
assert.match(source, /payload->'receipt_file'->>'sha256' = \$\{digest\}/, 'stale verification cannot overwrite a newer receipt');
console.log('PASS: 34 receipt-verification assertions run against candidate code');

