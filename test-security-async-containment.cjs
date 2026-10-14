'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
  const normative = scripts.find(script => script.includes('window.nrmPreguntar=async'));
  assert.ok(normative, `${file}: normative search module must exist`);
  const domErrors = [];
  const normativeWindow = { __sgIgn: error => domErrors.push(error) };
  const normativeContext = vm.createContext({
    window: normativeWindow,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: async () => { throw new Error('fetch should not run when DOM is absent'); }
  });
  vm.runInContext(normative, normativeContext);
  assert.equal(await normativeWindow.nrmPreguntar(), false, `${file}: missing question UI must resolve safely`);
  assert.equal(await normativeWindow.nrmBuscar(), false, `${file}: missing search UI must resolve safely`);
  assert.doesNotThrow(() => normativeWindow.nrmFiltro('ley'), `${file}: absent filter input must be ignored`);
  assert.equal(domErrors.length, 2, `${file}: missing DOM nodes must be reported without rejected promises`);
  console.log(`PASS: ${file} catches security and route-probe failures`);
}

(async () => {
  await verify('index.html');
  await verify('SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
