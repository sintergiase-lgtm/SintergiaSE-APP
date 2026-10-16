'use strict';

const assert = require('node:assert/strict');
async function main() {
  const { parseSessionAuthorization, parseSessionToken, validateSessionClaims } = await import('./supabase/functions/_shared/session-claims.mjs');

  const signature = 'A'.repeat(43);
  const token = `v1.e30.${signature}`;
  assert.deepEqual(parseSessionToken(token), { payloadSegment: 'e30', signatureSegment: signature }, 'canonical token is parsed');
  assert.deepEqual(parseSessionAuthorization(`Bearer ${token}`), { payloadSegment: 'e30', signatureSegment: signature }, 'canonical bearer header is parsed');
  assert.equal(parseSessionAuthorization(`Bearer v1.${'a'.repeat(4043)}.${signature}`), null, 'oversized authorization is rejected');
  assert.equal(parseSessionToken(`v1.${'a'.repeat(4043)}.${signature}`), null, 'oversized payload segment is rejected');
  assert.equal(parseSessionToken(`v1.e30.${'A'.repeat(42)}`), null, 'wrong HMAC signature length is rejected');
  assert.equal(parseSessionToken(`v1.e30.${'A'.repeat(44)}`), null, 'padded or oversized signature is rejected');
  assert.equal(parseSessionToken('v1.e3==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), null, 'non-base64url payload is rejected');
  assert.equal(parseSessionToken(`v2.e30.${signature}`), null, 'unknown token version is rejected');
  assert.equal(parseSessionToken(`v1.e30.${signature}.extra`), null, 'extra token segments are rejected');
  assert.equal(parseSessionAuthorization(token), null, 'bare token is not accepted as bearer authorization');
  assert.equal(parseSessionAuthorization(`bearer ${token}`), null, 'noncanonical bearer scheme is rejected');
  assert.equal(parseSessionAuthorization(`Bearer ${'x'.repeat(4090)}`), null, 'oversized authorization header is rejected');

  const now = 1_800_000_000;
const valid = {
  sub: 'local-qa-user',
  scope: 'operacion',
  tenant: 'sintergia',
  iat: now - 30,
  exp: now + 28_770,
  jti: '9f2a9bd3-8b09-4f7a-a9aa-3ef3af2bbbe1',
};

assert.strictEqual(validateSessionClaims(valid, now), valid, 'valid session claims are retained');
assert.equal(validateSessionClaims({ ...valid, scope: 'modo' }, now)?.scope, 'modo', 'the other supported login scope remains valid');

const rejected = [
  ['null claims', null],
  ['array claims', []],
  ['missing subject', { ...valid, sub: '' }],
  ['trimmed subject mismatch', { ...valid, sub: ' local-qa-user' }],
  ['oversized subject', { ...valid, sub: 'x'.repeat(129) }],
  ['control characters in subject', { ...valid, sub: 'user\u0000id' }],
  ['missing scope', { ...valid, scope: undefined }],
  ['unsupported scope', { ...valid, scope: 'admin' }],
  ['wrong tenant', { ...valid, tenant: 'another-company' }],
  ['noninteger issue time', { ...valid, iat: now - 30.5 }],
  ['issue time too far in the future', { ...valid, iat: now + 61 }],
  ['expired session', { ...valid, exp: now }],
  ['expiration before issue', { ...valid, exp: valid.iat }],
  ['lifetime exceeds eight hours', { ...valid, exp: valid.iat + 28_801 }],
  ['missing token id', { ...valid, jti: '' }],
  ['malformed token id', { ...valid, jti: 'not-a-uuid' }],
];
for (const [label, claims] of rejected) {
  assert.equal(validateSessionClaims(claims, now), null, label);
}
assert.equal(validateSessionClaims(valid, Number.NaN), null, 'invalid clock input fails closed');

console.log(`PASS: ${rejected.length + 3} strict session-claim assertions`);

}

main().catch(error => { console.error(error); process.exitCode = 1; });
