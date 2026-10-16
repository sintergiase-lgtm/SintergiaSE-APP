'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto ??= webcrypto;

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function signedBearer(key, claims) {
  const payload = base64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `Bearer v1.${payload}.${base64url(signature)}`;
}

async function main() {
  const { verifySessionAuthorization } = await import('./supabase/functions/_shared/session-verifier.mjs');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('local-qa-session-verifier-secret-32-bytes'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const now = Math.floor(Date.now() / 1000);
  const validClaims = {
    sub: 'synthetic-qa-user',
    scope: 'operacion',
    tenant: 'sintergia',
    iat: now,
    exp: now + 3600,
    jti: '9f2a9bd3-8b09-4f7a-a9aa-3ef3af2bbbe1',
  };

  let keyLoads = 0;
  const loadKey = async () => { keyLoads++; return key; };
  const validBearer = await signedBearer(key, validClaims);
  assert.deepEqual(await verifySessionAuthorization(validBearer, loadKey), validClaims, 'valid signed session is returned');
  assert.equal(keyLoads, 1, 'a valid token loads the verification key once');

  const malformed = await verifySessionAuthorization('bearer malformed', loadKey);
  assert.equal(malformed, null, 'malformed bearer is rejected');
  assert.equal(keyLoads, 1, 'malformed bearer is rejected before loading a key');

  const token = validBearer.slice(7);
  const [version, payload, signature] = token.split('.');
  const changedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  assert.equal(await verifySessionAuthorization(`Bearer ${version}.${payload}.${changedSignature}`, loadKey), null, 'invalid HMAC is rejected');
  assert.equal(await verifySessionAuthorization(`Bearer ${version}.${base64url(Buffer.from(JSON.stringify({ ...validClaims, sub: 'other-user' }))).replace(/=+$/,'')}.${signature}`, loadKey), null, 'tampered payload is rejected');

  const invalidClaims = await signedBearer(key, { ...validClaims, tenant: 'other-company' });
  assert.equal(await verifySessionAuthorization(invalidClaims, loadKey), null, 'signed claims outside the accepted tenant are rejected');
  const expiredClaims = await signedBearer(key, { ...validClaims, exp: now - 1 });
  assert.equal(await verifySessionAuthorization(expiredClaims, loadKey), null, 'expired signed claims are rejected');

  await assert.rejects(
    verifySessionAuthorization(validBearer, async () => { throw new Error('synthetic_key_store_unavailable'); }),
    /synthetic_key_store_unavailable/,
    'key-store errors propagate so protected endpoints can return 503 instead of 401',
  );

  console.log('PASS: shared session verifier accepts valid HMAC tokens and fails closed on malformed, altered, expired, or invalid-tenant tokens');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

