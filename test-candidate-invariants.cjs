const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = '/mnt/data/';
const cases = [
  ['verify-receipt-v14-candidate.ts', /parsed\?\.referenciaCoincide === true/, /parsed\?\.importeCoincide === true/, /MAX_REQUEST_BYTES/, /ALLOWED_ORIGINS/],
  ['receipt-register-v13-candidate.ts', /on conflict\(token\) do nothing/i, /409/, /MAX_REQUEST_BYTES/],
  ['upload-receipt-v12-candidate.ts', /MAX_REQUEST_BYTES/, /db\.begin/, /remove\(\[path\]\)/],
  ['upload-doc-v12-candidate.ts', /MAX_REQUEST_BYTES/, /remove\(\[path\]\)/],
  ['invoice-return-v12-candidate.ts', /MAX_REQUEST_BYTES/, /db\.begin/, /MAX_ATTACHMENTS/],
  ['cita-respuesta-v11-candidate.ts', /if \(req\.method === 'GET'\)/, /if \(req\.method === 'POST'\)/, /returning token/],
  ['ai-gateway-v14-candidate.ts', /OPENAI_ALLOWED_MODELS/, /MAX_REQUEST_BYTES/, /AbortSignal\.timeout/, /ALLOWED_ORIGINS/, /safeSchemaName/],
  ['send-email-v14-candidate.ts', /request_too_large/, /MAX_HTML_CHARS/, /sanitizeSubject\(body\.subject\)/, /ALLOWED_ORIGINS/, /AbortSignal\.timeout/, /!\/\[;,\]\/\.test\(value\)/],
  ['cita-email-v15-candidate.ts', /escapeHtmlText\(texto\)/, /sanitizeSubject/, /MAX_REQUEST_BYTES/, /AbortSignal\.timeout/, /allowed\.includes\(origin\)/],
  ['cita-recordatorio-v14-candidate.ts', /escapeHtmlText\(body\)/, /MAX_REQUEST_BYTES/, /MAX_TEXT_CHARS/, /AbortSignal\.timeout/],
  ['cita-anulacion-reprogramacion-v13-candidate.ts', /escapeHtmlText\(texto\)/, /MAX_REQUEST_BYTES/, /MAX_TEXT_CHARS/, /AbortSignal\.timeout/],
  ['cita-whatsapp-v14-candidate.ts', /MAX_REQUEST_BYTES/, /MAX_TEXT_CHARS/, /AbortSignal\.timeout/, /a\.includes\(o\)/],
  ['gmail-oauth-v11-candidate.ts', /function escapeHtml\(/, /Content-Security-Policy/, /Referrer-Policy/, /AbortSignal\.timeout/],
];
for (const [file, ...patterns] of cases) {
  const content = fs.readFileSync(root + file, 'utf8');
  for (const pattern of patterns) assert.match(content, pattern, `${file} missing invariant ${pattern}`);
}
console.log(`PASS: ${cases.length} candidate invariant groups`);
