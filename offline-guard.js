
(function () {
  'use strict';

  const GRANT = 'sintergia_biometric_last_online_ok_v1';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const AUTH_PATH = '/functions/v1/authenticate-biometric';

  function offlineGrantValid() {
    try {
      const value = localStorage.getItem(GRANT);
      if (!value) return false;

      const timestamp = Number(value);
      if (!Number.isFinite(timestamp)) return false;

      const age = Date.now() - timestamp;
      if (age < 0 || age > MAX_AGE) {
        localStorage.removeItem(GRANT);
        return false;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  function saveOfflineGrant() {
    try {
      localStorage.setItem(GRANT, String(Date.now()));
    } catch (_) {
      // Si el almacenamiento no está disponible, no conceder acceso offline.
    }
  }

  function isBiometricAuthRequest(input) {
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input && input.url
            ? input.url
            : String(input);

      const url = new URL(rawUrl, window.location.href);

      return (
        url.pathname.includes(AUTH_PATH) ||
        url.pathname.endsWith('/authenticate-biometric')
      );
    } catch (_) {
      return false;
    }
  }

  // Registrar una autenticación online que el servidor haya aceptado.
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (...args) {
      const isAuthRequest = isBiometricAuthRequest(args[0]);
      const response = await originalFetch(...args);

      if (isAuthRequest && response.ok) {
        try {
          const data = await response.clone().json();

          if (
            data &&
            data.ok === true &&
            typeof data.token === 'string' &&
            data.token.length > 20 &&
            !data.token.startsWith('local-')
          ) {
            saveOfflineGrant();
          }
        } catch (_) {
          // Una respuesta que no se pueda validar no concede acceso offline.
        }
      }

      return response;
    };
  }

  // Exponer el estado para que la aplicación pueda consultarlo.
  window.SintergiaOfflineGuard = Object.freeze({
    offlineGrantValid,
    clearOfflineGrant: function () {
      try {
        localStorage.removeItem(GRANT);
      } catch (_) {}
    }
  });
})();
