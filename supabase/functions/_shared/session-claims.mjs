'use strict';

const MAX_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
