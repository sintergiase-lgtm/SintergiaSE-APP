'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function verify(file) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const security = html.match(/<script id="sintergia-security-productivity-js">([\s\S]*?)<\/script>/i)?.[1];
  const map = html.match(/<script id="sintergia-mapa-offline-js">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(security, `${file}: security module must exist`);
  assert.ok(map, `${file}: offline map module must exist`);

  const helpers = security.match(/function reportError\(error\)\{[\s\S]*?\}\nfunction containAsync\(fn\)\{[^\n]*\}/)?.[0];
  assert.ok(helpers, `${file}: async failure containment helper must exist`);
  const errors = [];
  const window = { __sgIgn: error => errors.push(error) };
  const containAsync = new Function('window', `${helpers}\nreturn containAsync;`)(window);
  assert.equal(await containAsync(() => Promise.reject(new Error('async failure')))(), false,
    `${file}: async errors must be converted to a handled result`);
  assert.equal(await containAsync(() => { throw new Error('sync failure'); })(), false,
    `${file}: synchronous setup errors must be converted to a handled result`);
  assert.equal(errors.length, 2, `${file}: both errors must reach the diagnostic hook`);

  assert.match(security, /function getTimeout\(\)\{try\{[\s\S]*?catch\(error\)\{reportError\(error\);return 15;\}\}/,
    `${file}: unavailable storage must not break the inactivity timer`);
  assert.match(security, /safeLock=containAsync\(lock\),safeUnlock=containAsync\(unlock\)/,
    `${file}: lock/unlock operations must be guarded`);
  assert.match(security, /integrity\(\).*?\.catch\(reportError\)/,
    `${file}: digest failures must be handled`);
  assert.match(map, /var r;\s*try\s*\{\s*r = await rutaKm[\s\S]*?catch \(e\) \{ prog\.textContent = 'No se pudo probar la ruta:/,
    `${file}: route-probe failures must be displayed, not left as rejections`);
  console.log(`PASS: ${file} catches security and route-probe failures`);
}

(async () => {
  await verify('index.html');
  await verify('SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

