'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const start = html.indexOf('    var Geo = (function () {');
  const end = html.indexOf('\n    window.SintergiaGeo = Geo;', start);
  assert.ok(start >= 0 && end > start, `${file}: geolocation module must exist`);
  const source = `${html.slice(start, end)}\nglobalThis.__geo = Geo;`;

  const intervals = [];
  let clearWatchCalls = 0;
  let shouldThrowOnStart = false;
  let shouldThrowOnStop = false;
  let renderedHtml = '';
  const context = {
    window: {},
    navigator: {
      geolocation: {
        watchPosition() {
          if (shouldThrowOnStart) throw new Error('permission policy blocked geolocation');
          return 42;
        },
        clearWatch(id) {
          clearWatchCalls += 1;
          assert.equal(id, 42);
          if (shouldThrowOnStop) throw new Error('geolocation provider failed to stop');
        }
      }
    },
    setInterval(callback, delay) {
      const handle = { callback, delay };
      intervals.push(handle);
      return handle;
    },
    clearInterval() {},
    document: { getElementById: () => ({ set innerHTML(value) { renderedHtml = value; } }) },
    sessionStorage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => 'test-device' },
    esc: value => String(value ?? ''),
    escaparAtributo: value => String(value),
    urlSeguraVisual: value => String(value),
    Date,
    Math,
    URL,
    encodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  shouldThrowOnStart = true;
  assert.doesNotThrow(() => context.__geo.iniciar(), `${file}: a synchronous geolocation failure must not break login`);
  assert.equal(intervals.length, 0, `${file}: failed tracking must not start the visual refresh timer`);

  shouldThrowOnStart = false;
  context.__geo.iniciar();
  assert.equal(intervals.length, 1, `${file}: successful tracking keeps its refresh timer`);
  shouldThrowOnStop = true;
  assert.doesNotThrow(() => context.__geo.detener(), `${file}: a stop failure must not interrupt jornada closure`);
  assert.equal(clearWatchCalls, 1, `${file}: stop attempts to clear the active geolocation watch`);
  context.__geo.registrarRemoto({
    id: 'valid-device', nombre: 'Técnico', dni: 'X', modo: 'tecnico',
    lat: '40.4', lon: '-3.7', precision: 10, at: new Date().toISOString()
  });
  assert.match(renderedHtml, /40\.40000, -3\.70000/, `${file}: valid remote coordinates remain supported`);
  context.__geo.registrarRemoto({
    id: '__proto__', nombre: 'Equipo remoto', dni: 'Y', modo: 'tecnico',
    lat: 41, lon: -4, precision: 10, at: new Date().toISOString()
  });
  assert.match(renderedHtml, /41\.00000, -4\.00000/, `${file}: special object keys remain safe device identifiers`);
  const lastValidRender = renderedHtml;
  assert.doesNotThrow(() => context.__geo.registrarRemoto({
    id: 'broken-device', nombre: 'Técnico', dni: 'X', modo: 'tecnico',
    lat: 'not-a-coordinate', lon: 0, precision: 10, at: new Date().toISOString()
  }), `${file}: malformed cross-tab coordinates must not break rendering`);
  assert.equal(renderedHtml, lastValidRender, `${file}: malformed remote devices are ignored`);
  assert.doesNotThrow(() => context.__geo.registrarRemoto({
    id: 'out-of-range-device', nombre: 'Técnico', dni: 'X', modo: 'tecnico',
    lat: 95, lon: 0, precision: 10, at: new Date().toISOString()
  }), `${file}: coordinates outside valid ranges must be ignored`);
  assert.equal(renderedHtml, lastValidRender, `${file}: out-of-range remote devices are ignored`);
  for (const [id, lat, lon] of [['null-latitude', null, 0], ['empty-longitude', 40, ' '], ['bad-longitude', 40, 181]]) {
    assert.doesNotThrow(() => context.__geo.registrarRemoto({
      id, nombre: 'Técnico', dni: 'X', modo: 'tecnico', lat, lon, precision: 10, at: new Date().toISOString()
    }), `${file}: absent or invalid coordinates must be ignored`);
    assert.equal(renderedHtml, lastValidRender, `${file}: invalid coordinate pair ${id} is ignored`);
  }

  const syncStart = html.indexOf('    var Sync = (function () {');
  const syncEnd = html.indexOf('\n    window.SintergiaSync = Sync;', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, `${file}: cross-tab sync module must exist`);
  let storedKey = '';
  let storedValue = '';
  function BlockedBroadcastChannel() { throw new Error('BroadcastChannel is blocked in this context'); }
  const syncContext = {
    window: {
      SintergiaAccess: { grupo: 'operativo' },
      BroadcastChannel: BlockedBroadcastChannel,
      addEventListener() {}
    },
    BroadcastChannel: BlockedBroadcastChannel,
    localStorage: {
      setItem(key, value) { storedKey = key; storedValue = value; }
    }
  };
  vm.createContext(syncContext);
  vm.runInContext(`${html.slice(syncStart, syncEnd)}\nglobalThis.__sync = Sync;`, syncContext);
  assert.doesNotThrow(() => syncContext.__sync.asegurar(), `${file}: blocked BroadcastChannel must not abort app startup`);
  assert.equal(syncContext.__sync.asegurar(), null, `${file}: storage fallback is used when BroadcastChannel cannot be created`);
  assert.doesNotThrow(() => syncContext.__sync.emitir({ tipo: 'probe' }), `${file}: fallback publication must remain available`);
  assert.equal(storedKey, 'sintergia-sync-operativo_bus', `${file}: fallback writes to the active synchronization channel`);
  assert.equal(JSON.parse(storedValue).msg.tipo, 'probe', `${file}: fallback preserves the outgoing message`);

  console.log(`PASS: ${file} geolocation and cross-tab failure paths are contained`);
}
