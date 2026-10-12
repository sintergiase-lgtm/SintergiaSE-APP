'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(new URL('./sw.js', `file://${__filename}`).pathname, 'utf8');
assert.match(source, /const guardTag = '<script id="sintergia-offline-auth-guard" src="\.\/offline-guard\.js"><\/script>';/,
  'Guard injection must emit a valid literal closing script tag.');
assert.doesNotMatch(source, /<\\\\\/script>/,
  'Guard injection must not emit a backslash before the closing script tag.');
assert.match(source, /const CACHE_NAME = CACHE_PREFIX \+ 'v6';/,
  'Cache name must change so clients do not retain the old service-worker shell.');
assert.match(source, /if \(isBackend\(url, request\)\) return;/,
  'API/auth requests must bypass the shell cache.');
console.log('PASS: valid offline-guard script tag');
console.log('PASS: service-worker cache version bumped to v6');
console.log('PASS: API/auth requests bypass cache interception');
