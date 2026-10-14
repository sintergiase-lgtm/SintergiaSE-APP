'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/.test(attrs) && !/\btype\s*=\s*["']module["']/.test(attrs));

  assert.ok(scripts.length >= 40, `${file}: expected the app's inline script set, found ${scripts.length}`);
  const errors = [];
  for (let i = 0; i < scripts.length; i++) {
    try {
      new Function(scripts[i][2]);
    } catch (error) {
      errors.push(`script #${i + 1} (${scripts[i][1].trim().slice(0, 100)}): ${error.message}`);
    }
  }
  assert.deepEqual(errors, [], `${file}: ${errors.join('\n')}`);
  assert.doesNotThrow(() => new Function(scripts.map(([, , body]) => body).join('\n;\n')), `${file}: inline scripts must coexist in page order`);
  console.log(`PASS: ${file}: ${scripts.length} inline JavaScript blocks parse independently and together`);
}

