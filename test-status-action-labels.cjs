'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const correctLabel = '⚠️GUARDAR⚠️';
const legacyLabel = '⚠️GUARDA⚠️';

assert.equal(html.split(correctLabel).length - 1, 3, 'all three signed-part save actions must use the full GUARDAR label');
assert.equal(html.split(legacyLabel).length - 1, 0, 'legacy truncated GUARDА label must be absent');
assert.match(html, /if \(estadoParte === 'aparcado' \|\| estadoParte === 'en trayecto' \|\| estadoParte === 'realizándose'\)/, 'en trayecto, aparcado and realizándose must share the Parte action');
assert.equal(html.split("estadoParte === 'en trayecto' ? 'trayecto'").length - 1, 2, 'the action title and aria-label must identify en trayecto correctly');
assert.match(html, /const facturasAnuladasVinculadas = appState\.facturas/);
assert.match(html, /sgAction\("restaurarFactura", \[facturaIdx\]\)/, 'annulled invoices in Seguimiento must offer restore');
assert.match(html, /estadoNormalizado === 'terminado' \|\| estadoNormalizado === 'cobrado'\)/, 'annulled invoices must not fall through to the email action');
assert.equal(html.split('<span class="estado-realizado-alarma" aria-label="Terminado SIN firma"><span class="alarma-icono" aria-hidden="true">⚠️</span>Terminado SIN ✒️</span>').length - 1, 2, 'both unsigned-completed status badges must wrap the warning in the blinking icon class');
assert.equal(html.split('<span class="estado-realizado-alarma" aria-label="Terminado SIN firma">⚠️Terminado SIN ✒️</span>').length - 1, 0, 'raw warning symbols must not bypass the blink class');
console.log('PASS: all 3 signed-part save actions display ⚠️GUARDAR⚠️');
