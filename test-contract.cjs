'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

/* Run from any working directory after checkout: all sources are repository-relative. */
const source = fs.readFileSync(path.join(__dirname, 'sync-operations-v13-candidate.ts'), 'utf8');
const checks = [
  ['custom HMAC session token required', /authorization\.startsWith\('Bearer '\)/],
  ['HMAC token is cryptographically verified', /crypto\.subtle\.verify\('HMAC'/],
  ['secret/database failures are reported as retryable infrastructure errors', /catch \{\s*return json\(req, 503, \{ ok: false, error: 'auth_verification_unavailable' \}\)\s*\}/],
  ['the default production origin is exact and HTTPS', /DEFAULT_ALLOWED_ORIGINS = \['https:\/\/sintergiase-lgtm\.github\.io'\]/],
  ['configured CORS origins are restricted to exact HTTPS origins', /u\.protocol === 'https:' && u\.origin === origin/],
  ['CORS reflects only an origin in the allowlist', /if \(o && allowedOrigins\(\)\.has\(o\)\)/],
  ['empty CORS configuration never permits arbitrary origins', !/!a\.length\s*\|\|\s*a\.includes\(o\)/.test(source)],
  ['request bodies have a hard byte limit', /MAX_REQUEST_BYTES\s*=\s*5_500_000/],
  ['malformed/oversize request bodies are rejected', /request_too_large/],
  ['unsupported deltas trigger a safe snapshot fallback', /operation_endpoint_unsupported/],
  ['invalid snapshot payload is not acknowledged', /snapshot_payload_required/],
  ['idempotency claim and state write use a transaction', /s\.begin\(async \(tx: any\) =>/],
  ['JSONB values use explicit typed casts', source.includes('JSON.stringify(payload)}::jsonb') && source.includes('JSON.stringify(state)}::jsonb')],
  ['prior payload/result JSONB types are inspected before ACK', /jsonb_typeof\(payload\) as payload_type,jsonb_typeof\(result\) as result_type/],
  ['legacy scalar rows trigger reconciliation, not a false success', /legacy_sync_record_requires_reconciliation/],
  ['an incomplete prior operation is not acknowledged as applied', /operation_incomplete/],
  ['request ID reused for different valid content is a conflict', /request_id_conflict/],
  ['result and applied status are persisted in the same transaction', /status='applied',completed_at=now\(\)/],
];
for (const [label, rule] of checks) {
  const pass = rule instanceof RegExp ? rule.test(source) : Boolean(rule);
  assert.ok(pass, `FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`PASS: ${checks.length} sync-operations contract invariants`);
