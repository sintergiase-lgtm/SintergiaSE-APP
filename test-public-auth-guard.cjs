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
console.log(`PASS: auth guard y sintaxis de ${checked} scripts inline`);
