'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const remoteOrigin = 'https://bgjicsowspppsjzigazb.supabase.co';
(async () => {
  for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(html, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, `${file}: source must not contain raw disallowed control characters`);
    const manifestLinks = [...html.matchAll(/<link\b[^>]*\brel="manifest"[^>]*\bhref="([^"]+)"/gi)];
    assert.equal(manifestLinks.length, 1, `${file}: exactly one PWA manifest link should be present`);
    assert.equal(manifestLinks[0][1], './manifest.webmanifest', `${file}: manifest path must resolve from the repository root`);
    assert.match(html, /<link\b[^>]*\brel="apple-touch-icon"[^>]*\bhref="\.\/icon-192\.png"/i, `${file}: Apple touch icon must use an existing asset`);
    assert.doesNotMatch(html, /href="\/sintergia\//i, `${file}: repository assets must not use a stale deployment prefix`);
    assert.equal((html.match(/window\.__sgP25DynamicDelegation=true/g) || []).length, 1,
      `${file}: dynamic click delegation must not be duplicated`);
    const syncScript = html.match(/<script id="sintergia-correcciones-2026-09">([\s\S]*?)<\/script>/i);
    assert.ok(syncScript, `${file}: the synchronization script must exist`);
    const script = syncScript[1];
    const backendStart = script.indexOf('function backendFetch(url,options){');
    const backendEnd = script.indexOf('\nfunction syncToast', backendStart);
    const remoteStart = script.indexOf('async function obtenerRemoto(){');
    const remoteEnd = script.indexOf('\nfunction mergeEntityArrays', remoteStart);
    assert.ok(backendStart >= 0 && backendEnd > backendStart, `${file}: backendFetch must exist in the synchronization script`);
    assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, `${file}: obtenerRemoto must exist in the synchronization script`);
    const backendFetchSource = script.slice(backendStart, backendEnd);
    const obtenerRemotoSource = script.slice(remoteStart, remoteEnd);

    const calls = [];
    const context = {
      URL,
      window: {
        location: { origin: 'https://sintergiase-lgtm.github.io' },
        SINTERGIA_BACKEND_ORIGIN: remoteOrigin
      },
      fetch: (url, options) => {
        calls.push({ url, options });
        return Promise.resolve({ ok: true });
      }
    };
    vm.createContext(context);
    vm.runInContext(`${backendFetchSource}\nglobalThis.backendFetch = backendFetch;`, context);

    const endpoint = `${remoteOrigin}/functions/v1/realtime-snapshot`;
    context.backendFetch(endpoint, { method: 'GET' });
    assert.equal(calls.at(-1).url, endpoint, `${file}: the configured backend origin is accepted`);
    context.backendFetch('/functions/v1/realtime-snapshot', { method: 'GET' });
    assert.equal(calls.at(-1).url, 'https://sintergiase-lgtm.github.io/functions/v1/realtime-snapshot', `${file}: same-origin function routes remain supported`);
    assert.throws(() => context.backendFetch('https://evil.example/functions/v1/realtime-snapshot'), /Endpoint de backend no permitido/);
    assert.throws(() => context.backendFetch(`${remoteOrigin}/rest/v1/profiles`), /Endpoint de backend no permitido/);
    assert.throws(() => context.backendFetch(`https://user@bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot`), /Endpoint de backend no permitido/);
    assert.throws(() => context.backendFetch('https://['), /(?:Endpoint de backend no permitido|URL de backend no válida)/);
    for (const rejectedUrl of [
      `${remoteOrigin}/functions/v1/../rest/v1/profiles`,
      `${remoteOrigin}/functions/v1/../../rest/v1/profiles`,
      'https://bgjicsowspppsjzigazb.supabase.co.evil.example/functions/v1/realtime-snapshot',
      'ftp://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot',
      'data:text/plain,https://bgjicsowspppsjzigazb.supabase.co/functions/v1/realtime-snapshot',
      '//evil.example/functions/v1/realtime-snapshot'
    ]) assert.throws(() => context.backendFetch(rejectedUrl), /Endpoint de backend no permitido/);

    for (const invalidConfig of [
      `${remoteOrigin}/functions/v1`,
      `${remoteOrigin}?project=unexpected`,
      '//bgjicsowspppsjzigazb.supabase.co',
      'http://bgjicsowspppsjzigazb.supabase.co'
    ]) {
      const invalidConfigContext = {
        URL,
        window: {
          location: { origin: 'https://sintergiase-lgtm.github.io' },
          SINTERGIA_BACKEND_ORIGIN: invalidConfig
        },
        fetch: () => Promise.resolve({ ok: true })
      };
      vm.createContext(invalidConfigContext);
      vm.runInContext(`${backendFetchSource}\nglobalThis.backendFetch = backendFetch;`, invalidConfigContext);
      assert.throws(() => invalidConfigContext.backendFetch(endpoint, { method: 'GET' }), /Endpoint de backend no permitido/,
        `${file}: configured backend must be an absolute HTTPS origin without path or query`);
    }

    let remoteRequest;
    const remoteContext = {
      window: { authHeadersSintergia: () => ({ Authorization: 'Bearer test-session' }) },
      SYNC_API: endpoint,
      SYNC_CHANNEL: 'sintergia-realtime',
      backendFetch: (url, options) => {
        remoteRequest = { url, options };
        return Promise.resolve({ ok: true, json: async () => ({ snapshot: { revision: 7 } }) });
      }
    };
    vm.createContext(remoteContext);
    vm.runInContext(`${obtenerRemotoSource}\nglobalThis.obtenerRemoto = obtenerRemoto;`, remoteContext);
    const snapshot = await remoteContext.obtenerRemoto();
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), { revision: 7 });
    assert.equal(remoteRequest.options.headers.Authorization, 'Bearer test-session', `${file}: remote reads forward the active session header`);
    assert.equal(remoteRequest.options.credentials, 'omit', `${file}: remote reads do not send browser cookies`);
    assert.match(remoteRequest.url, /channel=sintergia-realtime$/);
    console.log(`PASS: ${file} backend allowlist and authenticated snapshot GET`);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
