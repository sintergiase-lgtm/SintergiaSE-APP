'use strict';

import { parseSessionAuthorization, validateSessionClaims } from './session-claims.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();

function base64urlDecode(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verify the app's signed bearer format after loading a verification key. */
export async function verifySessionAuthorization(authorization, loadVerificationKey) {
  const parsed = parseSessionAuthorization(authorization);
  if (!parsed) return null;
  if (typeof loadVerificationKey !== 'function') throw new TypeError('session_verification_key_loader_required');

  // Keep backend lookup failures visible to callers so they can return 503, not 401.
  const key = await loadVerificationKey();
  try {
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(parsed.signatureSegment),
      enc.encode(parsed.payloadSegment),
    );
    if (!validSignature) return null;
    const payload = JSON.parse(dec.decode(base64urlDecode(parsed.payloadSegment)));
    return validateSessionClaims(payload) || null;
  } catch {
    return null;
  }
}

