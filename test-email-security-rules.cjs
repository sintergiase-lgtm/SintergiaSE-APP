const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');
const emailSource = fs.readFileSync(path.join(__dirname, 'send-email-v14-candidate.ts'), 'utf8');
const aiSource = fs.readFileSync(path.join(__dirname, 'ai-gateway-v14-candidate.ts'), 'utf8');
const oauthSource = fs.readFileSync(path.join(__dirname, 'gmail-oauth-v11-candidate.ts'), 'utf8');
function extract(source, name) {
  const m = source.match(new RegExp(`function ${name}\\b[\\s\\S]*?\\n}`));
  assert.ok(m, `Function ${name} must exist in candidate source`);
  return m[0];
}
const testSource = [
  extract(emailSource, 'sanitizeSubject'),
  extract(emailSource, 'validEmail'),
  extract(aiSource, 'safeSchemaName'),
  extract(oauthSource, 'escapeHtml'),
  'globalThis.rules = { sanitizeSubject, validEmail, safeSchemaName, escapeHtml };'
].join('\n');
const compiled = stripTypeScriptTypes(testSource, { mode: 'strip' });
const sandbox = {};
vm.runInNewContext(compiled, sandbox);
const { sanitizeSubject, validEmail, safeSchemaName, escapeHtml } = sandbox.rules;
assert.equal(sanitizeSubject('Hola\r\nBcc: atacante@example.com'), 'Hola  Bcc: atacante@example.com');
assert.equal(sanitizeSubject('  asunto  '), 'asunto');
assert.equal(sanitizeSubject('x'.repeat(350)).length, 300);
assert.equal(validEmail('tecnico@sintergiase.app'), true);
assert.equal(validEmail('tecnico@example.com,attacker@example.com'), false);
assert.equal(validEmail('tecnico@example.com\r\nBcc:x@y.z'), false);
assert.equal(safeSchemaName('Bad schema.name/with spaces'), 'Bad_schema_name_with_spaces');
assert.equal(safeSchemaName('x'.repeat(100)).length, 64);
assert.equal(escapeHtml('<svg onload=alert(1)>'), '&lt;svg onload=alert(1)&gt;');
assert.equal(escapeHtml('A & B'), 'A &amp; B');
console.log('PASS: 10 tests of email header/address, schema names and OAuth HTML escaping');
