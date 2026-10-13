'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attrs]) => !/\bsrc\s*=/.test(attrs) && !/\btype\s*=\s*["']module["']/.test(attrs));

assert.ok(scripts.length >= 40, `expected the app's inline script set, found ${scripts.length}`);
const errors = [];
for (let i = 0; i < scripts.length; i++) {
  try {
    new Function(scripts[i][2]);
  } catch (error) {
    errors.push(`script #${i + 1} (${scripts[i][1].trim().slice(0, 100)}): ${error.message}`);
  }
}
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`PASS: ${scripts.length} inline JavaScript blocks parse without syntax errors`);
