'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
const checks = [
  ['custom HMAC session token required', /authorization\.startsWith\('Bearer '\)/],
  ['server infrastructure errors are not converted to 401', /auth_verification_unavailable/],
  ['default CORS origin is exact and HTTPS', /https:\/\/sintergiase-lgtm\.github\.io/],
  ['no arbitrary origin reflection/wildcard', !/Access-Control-Allow-Origin['"]\s*:\s*['"]\*/.test(source) && /allowedOrigins\(\)\.has\(origin\)/.test(source)],
  ['bounded request body', /MAX_REQUEST_BYTES\s*=\s*5_500_000/],
  ['unsupported deltas trigger safe snapshot fallback', source.includes('operation_endpoint_unsupported') && /return json\(req, 405,/.test(source)],
  ['invalid snapshot is not acknowledged', /snapshot_payload_required/],
  ['transaction wraps idempotency and state write', /database\.begin\(async \(tx: any\) =>/],
  ['JSONB writes use explicit casts', source.includes('JSON.stringify(payload)}::jsonb') && source.includes('JSON.stringify(state)}::jsonb')],
  ['request-id payload mismatch rejected as conflict', /request_id_conflict/],
  ['incomplete prior operation is not acknowledged as success', /operation_incomplete/],
  ['response result and applied status are written together', /status='applied',completed_at=now\(\)/],
];
for (const [label, rule] of checks) {
  const pass = rule instanceof RegExp ? rule.test(source) : Boolean(rule);
  assert.ok(pass, `FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`PASS: ${checks.length} contract invariants`);
