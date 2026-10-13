'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const candidateNames = [
  ['verify-receipt-v14-candidate.ts', 'auth', 'json'],
  ['send-email-v14-candidate.ts', 'session', 'output'],
  ['ai-gateway-v14-candidate.ts', 'session', 'json'],
];
function extract(source, name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\b[\\s\\S]*?\\n}\\n`));
  assert.ok(match, `function ${name} must exist in candidate source`);
  return match[0];
}
function makeContext(file, authName) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const dbState = { mode: 'ok' };
  async function db() {
    if (dbState.mode === 'throw') throw new Error('db_connection_failed');
    if (dbState.mode === 'empty') return [];
    return [{ value: 'test-secret' }];
  }
  const helpers = [extract(source, 'b64d'), extract(source, authName), extract(source, 'cors')].join('\n')
    + `\nglobalThis.candidateHelpers = { auth: ${authName}, cors };`;
  const compiled = ts.transpileModule(helpers, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const env = { ALLOWED_ORIGINS: 'https://sintergiase-lgtm.github.io,https://staging.example' };
  const context = vm.createContext({
    db, Deno: { env: { get: key => env[key] || '' } },
    enc: new TextEncoder(), dec: new TextDecoder(), TextEncoder, TextDecoder,
    crypto: webcrypto, atob, btoa, Date, Number, String, JSON, Math, Object, Set, URL, Request,
  });
  vm.runInContext(compiled, context);
  return { helpers: context.candidateHelpers, dbState, source };
}
async function token(payload) {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('test-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return `v1.${payloadPart}.${Buffer.from(signature).toString('base64url')}`;
}
(async () => {
  const valid = await token({ sub: 'test-user', exp: Date.now() / 1000 + 300 });
  const expired = await token({ sub: 'test-user', exp: Date.now() / 1000 - 1 });
  for (const [file, authName, responseName] of candidateNames) {
    const { helpers, dbState, source } = makeContext(file, authName);
    const request = t => new Request('https://functions.example/test', {
      headers: { Authorization: 'Bearer ' + t, Origin: 'https://sintergiase-lgtm.github.io' }
    });
    assert.equal((await helpers.auth(request(valid))).sub, 'test-user', file + ': valid HMAC token accepted');
    assert.equal(await helpers.auth(new Request('https://functions.example/test')), null, file + ': missing token rejected');
    assert.equal(await helpers.auth(request(await token({ sub: 'test-user', exp: Date.now() / 1000 - 1 }))), null, file + ': expired token rejected');
    const validParts = valid.split('.');
    assert.equal(await helpers.auth(request(validParts[0] + '.' + validParts[1] + '.invalidsignature')), null,
      file + ': invalid HMAC rejected');

    const allowed = helpers.cors(new Request('https://functions.example/test', {
      headers: { Origin: 'https://sintergiase-lgtm.github.io' }
    }));
    assert.equal(allowed['Access-Control-Allow-Origin'], 'https://sintergiase-lgtm.github.io', file + ': exact allowed CORS origin');
    const evil = helpers.cors(new Request('https://functions.example/test', {
      headers: { Origin: 'https://sintergiase-lgtm.github.io.evil.example' }
    }));
    assert.equal(evil['Access-Control-Allow-Origin'], undefined, file + ': hostile suffix origin rejected');

    dbState.mode = 'empty';
    await assert.rejects(() => helpers.auth(request(valid)), /auth_verification_unavailable/,
      file + ': missing HMAC secret must be treated as configuration failure');
    dbState.mode = 'throw';
    await assert.rejects(() => helpers.auth(request(valid)), /db_connection_failed/,
      file + ': database failure must remain distinguishable from invalid credentials');
    assert.match(source, new RegExp(`auth_verification_unavailable`), file + ': handler exposes recoverable 503 path');
    assert.match(source, new RegExp(`catch \\{ return ${responseName}\\(req, 503, \\{ ok: false, error: 'auth_verification_unavailable' \\}\\) \\}`),
      file + ': handler maps auth infrastructure failure to 503');
  }
  console.log('PASS: receipt/email/AI candidate CORS and HMAC session helper simulations');
})().catch(error => { console.error(error); process.exitCode = 1; });
