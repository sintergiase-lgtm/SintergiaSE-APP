'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const correctLabel = '⚠️GUARDAR⚠️';
const legacyLabel = '⚠️GUARDA⚠️';

assert.equal(html.split(correctLabel).length - 1, 3, 'all three signed-part save actions must use the full GUARDAR label');
assert.equal(html.split(legacyLabel).length - 1, 0, 'legacy truncated GUARDА label must be absent');
console.log('PASS: all 3 signed-part save actions display ⚠️GUARDAR⚠️');
