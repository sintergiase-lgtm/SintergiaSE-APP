'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

assert.doesNotMatch(
  html,
  /sintergia\.credentials\s+con\s+scope=modo\s+\(actualmente\s+[^)]+\)/i,
  'el cliente no debe publicar el valor configurado para acceso'
);
assert.doesNotMatch(html, /\bCLAVE_[A-Z_]*INICIAL\b/i, 'no debe quedar clave inicial embebida');
assert.doesNotMatch(html, /\b(?:configurar|verificar)Local\s*\(/, 'no debe quedar autenticación local legado');
assert.match(html, /function verificar\(scope, value\)[\s\S]{0,700}return verificarServidor\(scope, value\);/,
  'el acceso debe seguir pasando exclusivamente por el servidor');
assert.match(html, /function verificarServidor\(scope, value\)[\s\S]{0,500}fetch\(endpoint\(\)/,
  'el cliente debe invocar el endpoint de autenticación del servidor');

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let checked = 0;
for (const [index, match] of scripts.entries()) {
  const type = (match[1].match(/\btype\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || 'text/javascript';
  if (!/(?:java|ecma)script/i.test(type)) continue;
  new vm.Script(match[2], { filename: `index.html:inline-script-${index + 1}` });
  checked++;
}
assert.ok(checked > 0, 'debe haber scripts JavaScript que validar');

const profileMatch = html.match(/<script\b[^>]*id=["']sintergia-storage-profile-v1["'][^>]*>([\s\S]*?)<\/script\s*>/i);
assert.ok(profileMatch, 'debe existir el particionador de almacenamiento por perfil');
assert.match(html, /perfiles\.requiresReload\(\)/, 'un cambio de almacén debe recargar antes de abrir la aplicación');
assert.ok(html.includes("const simulacion = window.SintergiaStorageProfile && window.SintergiaStorageProfile.simulateNotice('email')"), 'el correo libre debe simularse en demo');
assert.match(html, /'\/functions\/v1\/cita-whatsapp': 'whatsapp'/, 'WhatsApp debe simularse en demo');
assert.ok(html.includes("simulateNotice(canal==='email'?'email':'whatsapp')"), 'los enlaces mailto/WhatsApp también deben simularse en demo');
assert.match(html, /tecnico: 'tecnico', demo: 'demo'/, 'la selección de perfil debe venir del resultado del servidor');

function storageSandbox(localEntries, sessionEntries) {
  const context = vm.createContext({ URL });
  vm.runInContext(
    `class TestStorage {
      constructor() { this._items = new Map(); }
      getItem(k) { k = String(k); return this._items.has(k) ? this._items.get(k) : null; }
      setItem(k, v) { this._items.set(String(k), String(v)); }
      removeItem(k) { this._items.delete(String(k)); }
      key(i) { return Array.from(this._items.keys())[Number(i)] || null; }
      clear() { this._items.clear(); }
      dump() { return Array.from(this._items.entries()); }
      get length() { return this._items.size; }
    }
    globalThis.window = globalThis;
    globalThis.Storage = TestStorage;
    globalThis.localStorage = new TestStorage();
    globalThis.sessionStorage = new TestStorage();
    globalThis.location = { href: 'https://app.example.test/', reloadCount: 0, reload() { this.reloadCount++; } };
    globalThis.fetchCalls = 0;
    globalThis.fetch = function () { globalThis.fetchCalls++; return Promise.resolve({ ok: true, status: 200 }); };
    globalThis.Response = class TestResponse {
      constructor(body, init) { this.body = body; this.status = init.status; this.ok = this.status >= 200 && this.status < 300; this.headers = init.headers; }
      json() { return Promise.resolve(JSON.parse(this.body)); }
    };
    globalThis.setTimeout = function (fn) { fn(); return 1; };
    globalThis.mostrarToast = function (message) { globalThis.lastToast = message; };`,
    context
  );
  for (const [k, v] of localEntries || []) context.localStorage.setItem(k, v);
  for (const [k, v] of sessionEntries || []) context.sessionStorage.setItem(k, v);
  vm.runInContext(profileMatch[1], context, { filename: 'sintergia-storage-profile-v1' });
  return context;
}
const demoPhysicalKey = '__sintergia_demo_v1__:sintergia_partes';
const expiry = Date.now() + 60 * 60 * 1000;
const sessionSeed = [['sintergia_auth_token', JSON.stringify({ token: 'v1.synthetic.signature', expiresAt: expiry })]];
const localSeed = [['sintergia_partes', 'operativo-v1'], [demoPhysicalKey, 'demo-v1']];

const preAuth = storageSandbox(localSeed, []);
assert.equal(preAuth.SintergiaStorageProfile.available, true);
assert.equal(preAuth.localStorage.getItem('sintergia_partes'), null, 'no profile means no app data is readable');
preAuth.localStorage.setItem('sintergia_partes', 'preauth-write');
assert.equal(preAuth.localStorage.dump().find(([k]) => k === 'sintergia_partes')[1], 'operativo-v1', 'pre-auth writes cannot modify operational data');
const activateAdmin = preAuth.SintergiaStorageProfile.activate('admin');
assert.equal(activateAdmin.changed, true);
assert.equal(preAuth.SintergiaStorageProfile.canPersist(), false, 'writes remain blocked until data reloads under the selected profile');
assert.equal(preAuth.localStorage.getItem('sintergia_partes'), 'operativo-v1', 'legacy operational keys remain accessible to admin');
preAuth.localStorage.setItem('sintergia_partes', 'unsafe-transition-write');
assert.equal(preAuth.localStorage.getItem('sintergia_partes'), 'operativo-v1');
for (const [k, v] of sessionSeed) preAuth.sessionStorage.setItem(k, v);
assert.equal(preAuth.SintergiaStorageProfile.scheduleResume('admin'), true);
const sharedBoot = storageSandbox(preAuth.localStorage.dump(), preAuth.sessionStorage.dump());
assert.equal(sharedBoot.SintergiaStorageProfile.consumeResume().mode, 'admin');
assert.equal(sharedBoot.SintergiaStorageProfile.canPersist(), true);
assert.equal(sharedBoot.localStorage.getItem('sintergia_partes'), 'operativo-v1');
assert.equal(sharedBoot.localStorage.length, 1, 'operational enumeration hides demo keys');
assert.equal(sharedBoot.localStorage.key(0), 'sintergia_partes');
sharedBoot.localStorage.setItem('sintergia_partes', 'operativo-v2');
assert.equal(sharedBoot.SintergiaStorageProfile.activate('tecnico').changed, false, 'admin and technician use one shared partition');
assert.equal(sharedBoot.localStorage.getItem('sintergia_partes'), 'operativo-v2');
assert.equal(sharedBoot.SintergiaStorageProfile.activate('demo').changed, true);
assert.equal(sharedBoot.SintergiaStorageProfile.canPersist(), false);
assert.equal(sharedBoot.localStorage.getItem('sintergia_partes'), 'demo-v1', 'demo reads only its own namespace');
assert.equal(sharedBoot.SintergiaStorageProfile.scheduleResume('demo'), true);
const demoBoot = storageSandbox(sharedBoot.localStorage.dump(), sharedBoot.sessionStorage.dump());
assert.equal(demoBoot.SintergiaStorageProfile.consumeResume().mode, 'demo');
assert.equal(demoBoot.SintergiaStorageProfile.canPersist(), true);
assert.equal(demoBoot.localStorage.getItem('sintergia_partes'), 'demo-v1');
demoBoot.localStorage.setItem('sintergia_partes', 'demo-v2');
demoBoot.localStorage.clear();
assert.equal(demoBoot.localStorage.getItem('sintergia_partes'), null);
assert.ok(demoBoot.localStorage.dump().some(([k, v]) => k === 'sintergia_partes' && v === 'operativo-v2'), 'clearing demo preserves operational data');
assert.ok(!demoBoot.localStorage.dump().some(([k]) => k === demoPhysicalKey), 'clearing demo removes only the demo partition');

const expiredSession = [
  ['sintergia_auth_token', JSON.stringify({ token: 'v1.synthetic.signature', expiresAt: Date.now() - 1000 })],
  ['sintergia_modo', 'demo'],
  ['sintergia_profile_resume_v1', '1']
];
const expiredBoot = storageSandbox(localSeed, expiredSession);
assert.equal(expiredBoot.SintergiaStorageProfile.profile(), null, 'expired sessions cannot activate a partition during reload');
assert.equal(expiredBoot.SintergiaStorageProfile.consumeResume(), null);
assert.equal(expiredBoot.localStorage.getItem('sintergia_partes'), null);

(async function verifyDemoOutboundMessages() {
  const sharedResponse = await sharedBoot.fetch('https://sintergiase.example/functions/v1/send-email', { method: 'POST' });
  assert.equal(sharedBoot.fetchCalls, 1, 'operational profile keeps normal email delivery');
  assert.equal(sharedResponse.status, 200);
  const demoResponse = await demoBoot.fetch('https://sintergiase.example/functions/v1/send-email', { method: 'POST' });
  assert.equal(demoBoot.fetchCalls, 0, 'demo notifications never leave the browser');
  const simulated = await demoResponse.json();
  assert.equal(simulated.simulated, true);
  assert.match(simulated.id, /^DEMO-SIMULADO-/);
  assert.match(demoBoot.lastToast, /no se ha contactado con clientes/i);
  console.log(`PASS: auth guard, ${checked} inline scripts and demo/operational storage isolation regressions`);
})().catch(error => { console.error(error); process.exitCode = 1; });
