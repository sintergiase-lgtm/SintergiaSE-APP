'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appStart = html.indexOf('let appState = {');
const appEnd = html.indexOf('\n    };', appStart);
assert.ok(appStart >= 0 && appEnd > appStart, 'appState declaration must be extractable');
const appObject = html.slice(appStart, appEnd);
const appKeys = [...appObject.matchAll(/^\s{8}([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]);
const classification = {
  clientes:'sync-entity', partes:'sync-entity', facturas:'sync-entity', pendientes:'sync-entity-avisos',
  partCounter:'sync-counter', facCounter:'sync-counter', stock:'sync-entity', stockListas:'sync-entity',
  filtroEstadoActivo:'local-ui', filtroFacturaEstadoActivo:'local-ui', filtroAvisosEstadoActivo:'local-ui',
  catalogo:'reference-config-not-synced-pending-policy', emailApi:'local-sensitive-config-not-synced',
  firmaDataUrl:'transient-sensitive-not-synced', sinFirmaAutorizado:'local-auth-context-not-synced',
  parteOrigenId:'transient-navigation-context', parteCadenaIds:'transient-navigation-context',
  tripInterval:'runtime-timer', workInterval:'runtime-timer', tripSeconds:'runtime-timer',
  workSeconds:'runtime-timer', totalKmReal:'runtime-telemetry-pending-policy',
  lastCoords:'runtime-location-not-synced', watchId:'runtime-timer', facturaActualSubiendoReciboIdx:'ui-transient',
  facturaActualPrevisualizandoIdx:'ui-transient', previewActual:'ui-transient', gpsLogActive:'runtime-telemetry-not-synced'
};
assert.deepEqual(appKeys.filter(k => !Object.prototype.hasOwnProperty.call(classification, k)), [],
  'every top-level appState key must have an explicit sync/local policy');
assert.deepEqual(Object.keys(classification).filter(k => !appKeys.includes(k)), [],
  'the inventory must not silently retain stale state keys');

const snapshotStart = html.indexOf('window.obtenerSnapshotSincronizacion=function');
const healthStart = html.indexOf('/* P13: healthcheck runtime', snapshotStart);
assert.ok(snapshotStart >= 0 && healthStart > snapshotStart, 'snapshot builder must be extractable');
const snapshotCode = html.slice(snapshotStart, healthStart);
assert.match(snapshotCode, /pendientes:st\.pendientes\|\|\[\]/, 'avisos are represented by the canonical pendientes collection');
assert.match(snapshotCode, /rutas:routeSync\?routeSync\.rutas:undefined/, 'route plans must be part of the snapshot');
assert.match(snapshotCode, /citas:routeSync\?routeSync\.citas:undefined/, 'appointment responses must be part of the snapshot');

const applyStart = html.indexOf('window.aplicarSnapshotSincronizacion=function');
const applyEnd = html.indexOf('window.probarSincronizacionMultidispositivo=', applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'snapshot applier must be extractable');
const applyCode = html.slice(applyStart, applyEnd);
assert.match(applyCode, /mergeSnapshotFromSync/, 'route/cita snapshot must be merged before acknowledging application');

const methodStart = html.indexOf('    function syncClone(value, fallback) {');
const methodEnd = html.indexOf('    window.FacturasIA = FacturasIA;', methodStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart, 'actual route merge methods must be extractable');
const methodCode = html.slice(methodStart, methodEnd);
const state = {
  rutas: [{ id: 'r1', fecha: '2026-10-13', nombre: 'Ruta local' }],
  citas: { a1: { respuesta: 'si', updatedAt: '2026-10-13T10:00:00.000Z', localOnly: true } }
};
let durable = true, saves = 0;
const appState = { citas: { a1: { respuesta: 'si', updatedAt: '2026-10-13T10:00:00.000Z', localOnly: true } } };
const api = new Function('RutasIA', 'state', 'save', 'window',
  methodCode + '; return RutasIA;')({}, state, () => { saves++; return durable; }, { appState });

const before = api.snapshotForSync();
assert.equal(before.rutas.length, 1);
assert.ok(before.citas.a1, 'snapshot must include canonical appState citations');
assert.equal(api.mergeSnapshotFromSync({
  rutas: [
    { id: 'r1', fecha: '2026-10-13', nombre: 'Ruta remota obsoleta' },
    { id: 'r2', fecha: '2026-10-14', nombre: 'Ruta nueva' }
  ],
  citas: {
    a1: { respuesta: 'no', updatedAt: '2026-10-13T09:00:00.000Z' },
    a2: { respuesta: 'si', updatedAt: '2026-10-13T11:00:00.000Z' }
  }
}), true);
assert.equal(state.rutas.length, 2, 'new routes from another device must be retained');
assert.equal(state.rutas.find(x => x.id === 'r1').nombre, 'Ruta local',
  'an unversioned or older route must not overwrite local data');
assert.equal(state.citas.a1.respuesta, 'si', 'older appointment response must not overwrite a newer local response');
assert.equal(state.citas.a2.respuesta, 'si', 'new appointment response must be merged');
assert.equal(appState.citas.a2.respuesta, 'si', 'merged appointments must update the app canonical state');
assert.ok(saves > 0, 'route merge must persist the state');

const previous = JSON.stringify({ rutas: state.rutas, citas: state.citas });
durable = false;
assert.equal(api.mergeSnapshotFromSync({ rutas: [{ id: 'r3' }], citas: { a3: { respuesta: 'no' } } }), false,
  'failed route storage must reject snapshot application');
assert.equal(JSON.stringify({ rutas: state.rutas, citas: state.citas }), previous,
  'failed persistence must roll back in-memory route and citation state');
console.log('PASS: state inventory, avisos mapping, route/cita snapshot merge and storage-failure rollback');
