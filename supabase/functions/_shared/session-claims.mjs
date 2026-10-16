'use strict';

const MAX_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SESSION_TOKEN_LENGTH = 4_089;
const MAX_SESSION_AUTHORIZATION_LENGTH = 4_096;
const SESSION_TOKEN = /^v1\.([A-Za-z0-9_-]{1,4042})\.([A-Za-z0-9_-]{43})$/;

export function parseSessionToken(token) {
  if (typeof token !== 'string' || token.length > MAX_SESSION_TOKEN_LENGTH) return null;
  const match = SESSION_TOKEN.exec(token);
  if (!match) return null;
  return { payloadSegment: match[1], signatureSegment: match[2] };
}

export function parseSessionAuthorization(authorization) {
  if (typeof authorization !== 'string' || authorization.length > MAX_SESSION_AUTHORIZATION_LENGTH) return null;
  if (!authorization.startsWith('Bearer ')) return null;
  return parseSessionToken(authorization.slice(7));
}

export function validateSessionClaims(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!Number.isSafeInteger(nowSeconds)) return null;

  const { sub, scope, tenant, iat, exp, jti } = payload;
  if (typeof sub !== 'string' || !sub || sub.trim() !== sub || sub.length > 128 || /[\u0000-\u001f\u007f]/.test(sub)) return null;
  if (scope !== 'modo' && scope !== 'operacion') return null;
  if (tenant !== 'sintergia') return null;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  if (iat > nowSeconds + MAX_FUTURE_CLOCK_SKEW_SECONDS) return null;
  if (exp <= nowSeconds || exp <= iat || exp - iat > MAX_SESSION_TTL_SECONDS) return null;
  if (typeof jti !== 'string' || !UUID_V4.test(jti)) return null;

  return payload;
}
