'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGpsFunction(html, file, geolocation, senalApp = null) {
  const start = html.indexOf('    async function obtenerTelemetriaGPSPro(opciones = {}) {');
  const end = html.indexOf('\n    async function verificarPrecisionGPS()', start);
  assert.ok(start >= 0 && end > start, `${file}: GPS function boundaries must be found`);
  const context = {
    window: { SenalApp: senalApp, isSecureContext: true, __sgIgn() {} },
    navigator: { geolocation },
    setTimeout,
    clearTimeout,
    Number,
    Date
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.__gps = obtenerTelemetriaGPSPro;`, context);
  return context.__gps;
}

(async () => {
  for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');

    const timeoutFallback = loadGpsFunction(html, file, {
      watchPosition() { return 1; },
      clearWatch() {},
      getCurrentPosition() { throw new Error('synchronous location provider failure'); }
    });
    const timedOut = await timeoutFallback({ tiempoMaximoMs: 5 });
    assert.equal(timedOut.lat, null, `${file}: a synchronous fallback failure after timeout must resolve safely`);
    assert.match(timedOut.direccion, /ubicación \(GPS\)|señal GPS/);

    let watchSuccess;
    const invalidCoordinate = loadGpsFunction(html, file, {
      watchPosition(success) { watchSuccess = success; return 2; },
      clearWatch() {},
      getCurrentPosition(_success, error) { error({ code: 2 }); }
    });
    const invalidPromise = invalidCoordinate({ tiempoMaximoMs: 1000 });
    assert.doesNotThrow(() => watchSuccess({ coords: { latitude: NaN, longitude: 0, accuracy: 1 } }),
      `${file}: malformed GPS callbacks must not throw outside the promise`);
    const invalid = await invalidPromise;
    assert.equal(invalid.lat, null, `${file}: invalid coordinates must resolve to the safe error result`);

    let validWatchSuccess;
    const observerFailure = loadGpsFunction(html, file, {
      watchPosition(success) { validWatchSuccess = success; return 3; },
      clearWatch() {},
      getCurrentPosition(_success, error) { error({ code: 2 }); }
    }, { gpsEstado() {}, gpsLectura() { throw new Error('display observer failed'); } });
    const validPromise = observerFailure({ tiempoMaximoMs: 1000 });
    assert.doesNotThrow(() => validWatchSuccess({ coords: { latitude: 40.4, longitude: -3.7, accuracy: 8 } }),
      `${file}: UI observer errors must not escape geolocation callbacks`);
    const valid = await validPromise;
    assert.equal(valid.lat, 40.4);
    assert.equal(valid.lon, -3.7);
    console.log(`PASS: ${file} GPS timeout, malformed coordinates, and observer failure paths`);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
