/* SintergiaSE — guardia de acceso offline limitado.
 * Debe cargarse antes de los scripts de la aplicación.
 * No concede autenticación: solo bloquea operaciones remotas durante el modo offline restringido.
 */
(function () {
  'use strict';

  const MODE = 'sintergia_offline_biometric_mode';
  const BIO = 'sintergia_biometric_auth';
  const LOCK = 'sintergia_offline_biometric_lockdown_v1';
  const GRANT = 'sintergia_biometric_last_online_ok_v1';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

  function get(store, key) {
    try { return store.getItem(key); } catch (_) { return null; }
  }
  function set(store, key, value) {
    try { store.setItem(key, value); return true; } catch (_) { return false; }
  }
  function remove(store, key) {
    try { store.removeItem(key); } catch (_) {}
  }
  function offlineGrantValid() {
    const t = Number(get(localStorage, GRANT) || 0);
    return Number.isFinite(t) && t > 0 && Date.now() >= t && Date.now() - t <= MAX_AGE;
  }
  function restricted() {
    const mode = get(sessionStorage, MODE);
    const bio = get(sessionStorage, BIO);
    const lock = get(localStorage, LOCK);
    return mode === 'restricted' || mode === 'true' || bio === 'offline-restricted' || lock === 'restricted' || lock === 'true';
  }
  function urlOf(input) {
    try {
      const raw = typeof input === 'string' || input instanceof URL
        ? String(input)
        : (input && input.url) || '';
      return new URL(raw, location.href);
    } catch (_) { return null; }
  }
  function isBackend(url, request) {
    if (!url) return false;
    if (request && request.headers && request.headers.has('authorization')) return true;
    const p = url.pathname.toLowerCase();
    const apiPath = /^\/(?:functions|rest|auth|storage|realtime)\/v1\//.test(p);
    if (apiPath && (/\.supabase\.(?:co|in)$/i.test(url.hostname) || url.origin === location.origin)) return true;
    // En modo restringido, toda petición fetch a otro origen también se considera remota.
    return url.origin !== location.origin;
  }
  function allowedWhileRestricted(url) {
    if (!url) return false;
    const p = url.pathname.toLowerCase().replace(/\/$/, '');
    const trustedOrigin = url.hostname.toLowerCase() === 'bgjicsowspppsjzigazb.supabase.co' || url.origin === location.origin;
    return trustedOrigin && /\/functions\/v1\/(?:authenticate|authenticate-biometric|health)$/.test(p);
  }
  function lockOfflineMode() {
    set(localStorage, LOCK, 'restricted');
    if (document.documentElement) document.documentElement.dataset.sintergiaOfflineLocked = 'true';
    pauseProtectedSync();
  }
  function unlockOfflineMode() {
    remove(localStorage, LOCK);
    remove(sessionStorage, MODE);
    if (get(sessionStorage, BIO) === 'offline-restricted') remove(sessionStorage, BIO);
    if (document.documentElement) delete document.documentElement.dataset.sintergiaOfflineLocked;
  }
  function pauseProtectedSync() {
    try { window.dispatchEvent(new CustomEvent('sintergia:offline-sync-pause')); } catch (_) {}
  }
  function resumeProtectedSync() {
    try { window.dispatchEvent(new CustomEvent('sintergia:offline-sync-resume')); } catch (_) {}
  }
  function installFetchGuard() {
    if (typeof window.fetch !== 'function' || window.__sintergiaFetchGuardInstalled) return;
    window.__sintergiaFetchGuardInstalled = true;
    const baseFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = urlOf(input);
      if (restricted() && isBackend(url, input) && !allowedWhileRestricted(url)) {
        try {
          window.dispatchEvent(new CustomEvent('sintergia-offline-remote-blocked', { detail: { url: url ? url.href : '' } }));
        } catch (_) {}
        throw new TypeError('SintergiaSE: operación remota bloqueada en modo biométrico sin conexión.');
      }
      return baseFetch(input, init);
    };
  }
  function refreshState() {
    if (restricted()) {
      pauseProtectedSync();
      if (!offlineGrantValid()) lockOfflineMode();
    } else {
      if (document.documentElement) delete document.documentElement.dataset.sintergiaOfflineLocked;
    }
  }
  function initialize() {
    installFetchGuard();
    refreshState();
    window.addEventListener('online', function () {
      // Volver la conexión no elimina por sí solo el modo restringido.
      if (restricted()) pauseProtectedSync();
      else resumeProtectedSync();
    });
    window.addEventListener('offline', function () {
      if (restricted()) pauseProtectedSync();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshState();
    });
  }

  window.SintergiaOfflineGuard = Object.freeze({
    restricted,
    offlineGrantValid,
    lockOfflineMode,
    unlockOfflineMode,
    pauseProtectedSync,
    resumeProtectedSync
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
