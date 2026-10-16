'use strict';
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
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
    encoding: 'utf8',
    env: { ...process.env, CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const source = readFileSync(path.join(root, 'index.html'), 'utf8');
  const built = readFileSync(path.join(output, 'index.html'), 'utf8');
  const inlineImages = [...source.matchAll(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([^"']+)\2/gi)]
    .filter(match => Buffer.from(match[4], 'base64').length >= 8192);
  assert.equal(inlineImages.length, 2, 'expected the two large visible logo images');
  assert.ok(Buffer.byteLength(built) < Buffer.byteLength(source) - 1_000_000,
    'the generated HTML must remove more than 1 MB of inline script and image payload');
  assert.doesNotMatch(built, /<img\b[^>]*\bsrc\s*=\s*["']data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]{8192}/i,
    'large image payloads must not remain in img src attributes');

  const productionHost = 'bgjicsowspppsjzigazb.supabase.co';
  const previewHost = 'sintergiase-preview-backend.invalid';
  const previewOutput = path.join(output, 'preview');
  mkdirSync(previewOutput);
  const previewResult = spawnSync(process.execPath, ['scripts/build-static.mjs', previewOutput], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CF_PAGES: '1', CF_PAGES_BRANCH: 'security/preview-backend-isolation-20261016' }
  });
  assert.equal(previewResult.status, 0, previewResult.stdout + previewResult.stderr);
  const previewTextFiles = [
    'index.html', '_headers', 'sw.js', 'manifest.webmanifest',
    'offline-guard.js', 'offline-login-bridge.js'
  ].map(name => path.join(previewOutput, name));
  previewTextFiles.push(...readdirSync(path.join(previewOutput, 'assets'))
    .filter(name => name.endsWith('.js'))
    .map(name => path.join(previewOutput, 'assets', name)));
  const previewText = previewTextFiles.map(file => readFileSync(file, 'utf8')).join('\n');
  assert.ok(previewText.includes(previewHost), 'preview must use the non-routable disabled-backend host');
  assert.ok(!previewText.includes(productionHost), 'preview artifacts must not contain the production Supabase host');
  const mainTextFiles = [
    path.join(output, 'index.html'), path.join(output, '_headers'),
    path.join(output, 'offline-guard.js'), ...readdirSync(path.join(output, 'assets'))
      .filter(name => name.endsWith('.js'))
      .map(name => path.join(output, 'assets', name))
  ];
  assert.ok(mainTextFiles.some(file => readFileSync(file, 'utf8').includes(productionHost)),
    'the production build must keep its configured backend');

  const missingBranchOutput = path.join(output, 'missing-branch');
  mkdirSync(missingBranchOutput);
  const missingBranchEnv = { ...process.env, CF_PAGES: '1' };
  delete missingBranchEnv.CF_PAGES_BRANCH;
  const missingBranchResult = spawnSync(process.execPath, ['scripts/build-static.mjs', missingBranchOutput], {
    cwd: root,
    encoding: 'utf8',
    env: missingBranchEnv
  });
  assert.notEqual(missingBranchResult.status, 0, 'a Pages build with no branch must fail closed');
  assert.match(missingBranchResult.stderr, /CF_PAGES_BRANCH is required/,
    'missing branch failure must explain the isolation requirement');

  const assetsDir = path.join(output, 'assets');
  const assets = readdirSync(assetsDir);
  const imageAssets = assets.filter(name => !name.startsWith('script-'));
  const scriptAssets = assets.filter(name => /^script-[a-f0-9]{64}\.js$/.test(name));
  assert.equal(imageAssets.length, 2, 'one asset per distinct inline logo');
  for (const match of inlineImages) {
    const bytes = Buffer.from(match[4], 'base64');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const ext = match[3].toLowerCase() === 'image/jpeg' ? 'jpg' : match[3].slice('image/'.length);
    const name = 'inline-' + hash + '.' + ext;
    assert.ok(imageAssets.includes(name), 'hashed image asset must be emitted');
    assert.deepEqual(readFileSync(path.join(assetsDir, name)), bytes, 'asset bytes must be lossless');
    assert.ok(built.includes('./assets/' + name), 'generated HTML must reference the image');
  }

  const sourceScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/.test(attrs))
    .filter(([, attrs]) => {
      const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || 'text/javascript';
      return /(?:java|ecma)script/i.test(type);
    });
  assert.equal(sourceScripts.length, 46, 'expected the complete application JavaScript block set');
  const builtScripts = [...built.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(builtScripts.length, sourceScripts.length, 'all script elements must be preserved');
  assert.ok(builtScripts.every(([, attrs]) => /\bsrc\s*=\s*["']\.\/assets\/script-[a-f0-9]{64}\.js["']/i.test(attrs)),
    'each application script must be externalized to a content-hashed same-origin asset');
  assert.ok(builtScripts.every(([, attrs]) => /\bdefer\b/i.test(attrs)),
    'external scripts must download in parallel while preserving document order');
  assert.equal(scriptAssets.length, new Set(sourceScripts.map(([, , body]) =>
    createHash('sha256').update(body).digest('hex')
  )).size, 'duplicate scripts must share content-hashed assets');
  for (const [, attrs, body] of builtScripts) {
    assert.equal(body.trim(), '', 'the production HTML must not contain inline script bodies');
    const name = (attrs.match(/\bsrc\s*=\s*["']\.\/assets\/(script-[a-f0-9]{64}\.js)["']/i) || [])[1];
    assert.ok(statSync(path.join(assetsDir, name)).isFile(), 'the referenced JavaScript asset must exist');
  }

  const appScripts = [];
  for (const [, , body] of sourceScripts) {
    new vm.Script(body, { filename: 'index.html:inline-source' });
    appScripts.push(body);
  }
  for (const name of scriptAssets) {
    const body = readFileSync(path.join(assetsDir, name), 'utf8');
    assert.equal(createHash('sha256').update(body).digest('hex'), name.slice('script-'.length, -3),
      'JavaScript asset name must match its content hash');
    new vm.Script(body, { filename: name });
  }
  const applicationSource = appScripts.join('\n');
  assert.match(applicationSource, /function verificarServidor/, 'server authentication flow must remain');
  assert.doesNotMatch(applicationSource, /\b(?:configurar|verificar)Local\s*\(/i,
    'the build must not reintroduce local authentication');

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
    'Content-Security-Policy-Report-Only:',
    "script-src 'self'",
    "script-src-elem 'self'",
    "script-src-attr 'unsafe-inline'",
    'Cache-Control: public, max-age=31536000, immutable'
  ]) {
    assert.ok(headers.includes(required), 'security/performance header must ship: ' + required);
  }
  assert.doesNotMatch(headers, /script-src 'self' 'unsafe-inline'/i,
    'the report policy must not allow inline script elements');
  assert.doesNotMatch(headers, /unsafe-eval/i, 'the report-only CSP must not authorize eval');

  console.log('PASS: logo assets, ' + sourceScripts.length + ' extracted scripts, content hashes, auth guard, CSP report policy, and immutable asset caching');
} finally {
  rmSync(output, { recursive: true, force: true });
}
