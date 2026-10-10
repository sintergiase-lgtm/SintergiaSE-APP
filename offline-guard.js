
/* SintergiaSE — Protección biométrica offline */
(function () {
  "use strict";

  const MODE = "sintergia_offline_biometric_mode";
  const BIO = "sintergia_biometric_auth";
  const LOCK = "sintergia_offline_biometric_lockdown_v1";
  const GRANT = "sintergia_biometric_last_online_ok_v1";
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

  function getStore(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function setStore(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStore(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function offlineGrantValid() {
    const raw = getStore(GRANT);
    if (!raw) return false;

    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      removeStore(GRANT);
      return false;
    }

    if (Date.now() - timestamp > MAX_AGE) {
      removeStore(GRANT);
      return false;
    }

    return true;
  }

  function clearOfflineGrant() {
    removeStore(GRANT);
  }

  function isBiometricAuthRequest(input) {
    let url = "";

    try {
      url = typeof input === "string"
        ? input
        : input && input.url
          ? input.url
          : String(input || "");
    } catch (_) {
      return false;
    }

    return url.includes("/functions/v1/authenticate-biometric");
  }

  function isAllowedWhileRestricted(input) {
    let url = "";

    try {
      url = typeof input === "string"
        ? input
        : input && input.url
          ? input.url
          : String(input || "");
    } catch (_) {
      return false;
    }

    return (
      url.includes("/functions/v1/authenticate-biometric") ||
      url.includes("/functions/v1/health")
    );
  }

  function restricted() {
    return getStore(MODE) === "true" ||
      getStore(LOCK) === "true";
  }

  function lockOfflineMode() {
    setStore(LOCK, "true");
    document.documentElement.dataset.sintergiaOfflineLocked = "true";
  }

  function unlockOfflineMode() {
    removeStore(LOCK);
    delete document.documentElement.dataset.sintergiaOfflineLocked;
  }

  function pauseProtectedSync() {
    try {
      window.dispatchEvent(
        new CustomEvent("sintergia:offline-sync-pause")
      );
    } catch (_) {}
  }

  function resumeProtectedSync() {
    try {
      window.dispatchEvent(
        new CustomEvent("sintergia:offline-sync-resume")
      );
    } catch (_) {}
  }

  function saveGrantFromResponse(response, data) {
    if (!response || !response.ok || !data || data.ok !== true) {
      return;
    }

    const token = typeof data.token === "string" ? data.token : "";

    if (token.length > 20 && !token.startsWith("local-")) {
      setStore(GRANT, String(Date.now()));
      unlockOfflineMode();
    }
  }

  function installFetchGuard() {
    if (typeof window.fetch !== "function" || window.__sintergiaFetchGuardInstalled) {
      return;
    }

    window.__sintergiaFetchGuardInstalled = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (input, init) {
      if (
        restricted() &&
        !navigator.onLine &&
        !isAllowedWhileRestricted(input)
      ) {
        throw new TypeError(
          "SintergiaSE: operación de backend bloqueada en modo offline."
        );
      }

      const response = await originalFetch(input, init);

      if (isBiometricAuthRequest(input) && response.ok) {
        try {
          const copy = response.clone();
          const data = await copy.json();
          saveGrantFromResponse(response, data);
        } catch (_) {
          // Una respuesta inesperada no concede acceso offline.
        }
      }

      return response;
    };
  }

  function checkGrantExpiry() {
    if (getStore(MODE) === "true" && !offlineGrantValid()) {
      lockOfflineMode();
      pauseProtectedSync();
    }
  }

  function initialize() {
    installFetchGuard();

    if (restricted()) {
      pauseProtectedSync();
    }

    checkGrantExpiry();

    window.addEventListener("online", function () {
      resumeProtectedSync();
    });

    window.addEventListener("offline", function () {
      if (restricted()) {
        pauseProtectedSync();
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) checkGrantExpiry();
    });
  }

  window.SintergiaOfflineGuard = {
    restricted,
    offlineGrantValid,
    clearOfflineGrant,
    lockOfflineMode,
    unlockOfflineMode,
    pauseProtectedSync,
    resumeProtectedSync
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
