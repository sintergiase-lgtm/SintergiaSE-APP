const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const emailSource = fs.readFileSync('/mnt/data/send-email-v14-candidate.ts', 'utf8');
const aiSource = fs.readFileSync('/mnt/data/ai-gateway-v14-candidate.ts', 'utf8');
const oauthSource = fs.readFileSync('/mnt/data/gmail-oauth-v11-candidate.ts', 'utf8');
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
const compiled = ts.transpileModule(testSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
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
