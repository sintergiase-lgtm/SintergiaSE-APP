'use strict';
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const root = __dirname;
const output = mkdtempSync(path.join(os.tmpdir(), 'sintergia-static-build-'));
try {
  const result = spawnSync(process.execPath, ['scripts/build-static.mjs', output], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const source = readFileSync(path.join(root, 'index.html'), 'utf8');
  const built = readFileSync(path.join(output, 'index.html'), 'utf8');
  const inlineImages = [...source.matchAll(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([^"']+)\2/gi)]
    .filter(match => Buffer.from(match[4], 'base64').length >= 8192);
  assert.equal(inlineImages.length, 2, 'expected the two large visible logo images');
  assert.ok(Buffer.byteLength(built) < Buffer.byteLength(source) - 300000,
    'the generated HTML must remove at least 300 KB of base64 payload');
  assert.doesNotMatch(built, /<img\b[^>]*\bsrc\s*=\s*["']data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]{8192}/i,
    'large image payloads must not remain in img src attributes');

  const assetsDir = path.join(output, 'assets');
  const assets = readdirSync(assetsDir);
  assert.equal(assets.length, 2, 'one asset per distinct inline logo');
  for (const match of inlineImages) {
    const bytes = Buffer.from(match[4], 'base64');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const ext = match[3].toLowerCase() === 'image/jpeg' ? 'jpg' : match[3].slice('image/'.length);
    const name = 'inline-' + hash + '.' + ext;
    assert.ok(assets.includes(name), 'hashed image asset must be emitted');
    assert.deepEqual(readFileSync(path.join(assetsDir, name)), bytes, 'asset bytes must be lossless');
    assert.ok(built.includes('./assets/' + name), 'generated HTML must reference the image');
  }
  for (const name of ['_headers', 'sw.js', 'manifest.webmanifest', 'offline-guard.js', 'offline-login-bridge.js', 'icon-192.png', 'icon-512.png']) {
    assert.ok(statSync(path.join(output, name)).isFile(), 'runtime asset must be copied: ' + name);
  }

  const headers = readFileSync(path.join(output, '_headers'), 'utf8');
  for (const required of [
    'Strict-Transport-Security: max-age=31536000',
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy:',
    'Content-Security-Policy-Report-Only:'
  ]) {
    assert.ok(headers.includes(required), 'security header must ship: ' + required);
  }
  assert.doesNotMatch(headers, /unsafe-eval/i, 'the report-only CSP must not authorize eval');

  const scripts = [...built.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  let checked = 0;
  for (const [index, match] of scripts.entries()) {
    const type = (match[1].match(/\btype\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || 'text/javascript';
    if (!/(?:java|ecma)script/i.test(type)) continue;
    new vm.Script(match[2], { filename: 'dist/index.html:inline-script-' + (index + 1) });
    checked++;
  }
  assert.equal(checked, 46, 'the optimized HTML must preserve all inline scripts');
  assert.match(built, /function verificarServidor/, 'server authentication flow must remain');
  assert.doesNotMatch(built, /\b(?:configurar|verificar)Local\s*\(/i,
    'the build must not reintroduce local authentication');
  console.log('PASS: externalized logos, lossless assets, runtime files, auth guard, and ' + checked + ' scripts');
} finally {
  rmSync(output, { recursive: true, force: true });
}
