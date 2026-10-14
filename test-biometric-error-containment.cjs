'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function makeUnlock(source, options = {}) {
  const alerts = [], errors = [];
  let busy = false;
  const window = {
    __sgIgn: error => errors.push(error),
    SintergiaSecurity: {
      estaBloqueada: options.isLocked || (() => false),
      bloquear: options.lock || (async () => { throw new Error('session storage blocked'); })
    }
  };
  const factory = new Function('deps', `
    const BIO='test-bio';
    let biometricOperationInProgress=false;
    const {load,window,alert,setBiometricBusy}=deps;
    ${source}
    return biometricUnlock;
  `);
  const unlock = factory({
    load: options.load || (() => ({ id: 'credential' })),
    window,
    alert: message => alerts.push(message),
    setBiometricBusy: value => { busy = value; }
  });
  return { unlock, alerts, errors, get busy() { return busy; } };
}

(async () => {
  for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const start = html.indexOf('async function biometricUnlock(){');
    const end = html.indexOf('\nfunction renderSecurityBio', start);
    assert.ok(start >= 0 && end > start, `${file}: biometric unlock boundaries must be found`);
    const source = html.slice(start, end);

    const storageFailure = makeUnlock(source, { load: () => { throw new Error('storage unavailable'); } });
    assert.equal(await storageFailure.unlock(), false, `${file}: storage failure before WebAuthn must resolve safely`);
    assert.equal(storageFailure.errors.length, 1);

    const lockFailure = makeUnlock(source);
    assert.equal(await lockFailure.unlock(), false, `${file}: failure to lock the app must not reject biometric unlock`);
    assert.equal(lockFailure.errors.length, 1);
    assert.equal(lockFailure.busy, false, `${file}: failed preflight must not leave biometric controls busy`);

    assert.match(html, /bioLock\.addEventListener\('click',[^\n]*biometricUnlock\(\)\.catch\(/,
      `${file}: the biometric button must contain any unexpected async rejection`);
    console.log(`PASS: ${file} biometric preflight failures are contained`);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
