/* SintergiaSE — puente para acceso al inicio mediante biometría registrada.
 * Cargar al final de index.html, antes de </body>.
 * Modo offline: técnico, restringido, con autorización online de máximo 7 días.
 */
(function () {
  'use strict';

  const BIO = 'sintergia_biometric_auth';
  const MODE = 'sintergia_offline_biometric_mode';
  const GRANT = 'sintergia_biometric_last_online_ok_v1';
  const LOCK = 'sintergia_offline_biometric_lockdown_v1';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  let forceBiometric = false;

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function grantValid() {
    const t = Number(localStorage.getItem(GRANT) || 0);
    return Number.isFinite(t) && t > 0 && Date.now() >= t && Date.now() - t <= MAX_AGE;
  }
  function connectivityError(error) {
    if (location.protocol !== 'https:') return false;
    if (!navigator.onLine) return true;
    const msg = String(error && error.message || error || '');
    if (/HTTP\s*(401|403|404|409|422|429)\b/i.test(msg)) return false;
    return error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|internet disconnected|err_name_not_resolved|err_internet_disconnected|http\s*5\d\d|timeout|timed out/i.test(msg);
  }
  function setIdentityFromLocalSignature() {
    const signature = readJson('sintergia_tecnico_firma_dia_v1');
    if (!signature || !String(signature.nombre || '').trim() || !String(signature.dni || '').trim()) {
      throw new Error('La biometría se ha validado, pero no hay una identidad/firma local recuperable. Conéctate e inicia sesión una vez para guardar esos datos.');
    }
    const name = document.getElementById('sintergia-access-name');
    const dni = document.getElementById('sintergia-access-dni');
    if (name) name.value = String(signature.nombre).trim();
    if (dni) dni.value = String(signature.dni).trim().toUpperCase().replace(/[\s.\-]/g, '');
    window.SintergiaTechnicianSignature = signature;
  }
  async function authorizeWithBiometric() {
    if (location.protocol !== 'https:') throw new Error('El acceso biométrico requiere HTTPS. Abre la app desde su dirección https://, no desde un archivo local.');
    const record = readJson(BIO);
    if (!record || record.backendRegistered !== true || !(record.credentialId || record.id)) {
      throw new Error('No hay una biometría registrada y confirmada por el servidor en este dispositivo. Conéctate y registra/prueba la biometría primero.');
    }
    if (!navigator.onLine && !grantValid()) {
      throw new Error('La autorización offline ha caducado o no existe. Hace falta validar la biometría con Internet y volver a intentarlo.');
    }
    if (!window.HorarioSintergia || typeof window.HorarioSintergia.desbloquearBiometria !== 'function') {
      throw new Error('El módulo biométrico aún no está listo. Recarga la app e inténtalo otra vez.');
    }
    const ok = await window.HorarioSintergia.desbloquearBiometria();
    const authState = sessionStorage.getItem(BIO);
    if (!ok || (authState !== 'offline-restricted' && authState !== '1')) {
      throw new Error('La comprobación biométrica no ha autorizado la entrada. No se ha abierto la aplicación.');
    }
    if (authState === 'offline-restricted' && !grantValid()) {
      throw new Error('La autorización offline ha caducado. Conéctate a Internet y valida la biometría.');
    }
    // Desbloquear solo si ya existe la envoltura local común; no borra ni reinicia claves si falla.
    if (window.SintergiaLocalCrypto && window.SintergiaLocalCrypto.bloqueado()) {
      const dataUnlocked = await window.SintergiaLocalCrypto.desbloquear('SintergiaSE|datos-locales|v1');
      if (!dataUnlocked || window.SintergiaLocalCrypto.bloqueado()) {
        throw new Error('La biometría es válida, pero los datos locales están cifrados con otra contraseña. No se han borrado ni reiniciado. Usa la contraseña una vez con conexión para preparar el acceso offline.');
      }
    }
    setIdentityFromLocalSignature();
    return true;
  }
  function clearRestrictionAfterOnlineLogin() {
    try {
      sessionStorage.removeItem(MODE);
      if (sessionStorage.getItem(BIO) === 'offline-restricted') sessionStorage.removeItem(BIO);
      localStorage.removeItem(LOCK);
    } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('sintergia:offline-sync-resume')); } catch (_) {}
  }

  // Una biometría que el backend acaba de verificar también limpia un bloqueo viejo.
  window.addEventListener('sintergia-biometric-unlock', function () {
    try { if (sessionStorage.getItem(BIO) === '1') clearRestrictionAfterOnlineLogin(); } catch (_) {}
  });

  const baseCrypto = window.SintergiaCrypto;
  if (baseCrypto && typeof baseCrypto.verificarModo === 'function') {
    const patchedCrypto = Object.assign({}, baseCrypto);
    patchedCrypto.verificarModo = async function (value) {
      if (forceBiometric) {
        forceBiometric = false;
        await authorizeWithBiometric();
        return 'tecnico'; // el acceso sin servidor nunca concede modo administrador/demo
      }
      try {
        const mode = await baseCrypto.verificarModo(value);
        if (mode) clearRestrictionAfterOnlineLogin();
        return mode;
      } catch (error) {
        if (!connectivityError(error)) throw error; // nunca usar biometría offline para saltarse un rechazo 401/403
        await authorizeWithBiometric();
        return 'tecnico';
      }
    };
    window.SintergiaCrypto = Object.freeze(patchedCrypto);
  }

  function installEntryButton() {
    const form = document.getElementById('sintergia-step-pass');
    const password = document.getElementById('sintergia-access-password');
    if (!form || !password || form.querySelector('[data-sintergia-biometric-entry="1"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.dataset.sintergiaBiometricEntry = '1';
    button.textContent = '🔐 Entrar con biometría (también sin conexión)';
    button.style.width = '100%';
    button.style.marginTop = '12px';
    button.addEventListener('click', function () {
      forceBiometric = true;
      password.value = 'SINTERGIA_BIOMETRIC_ENTRY';
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
    });
    const help = document.createElement('p');
    help.textContent = 'Requiere biometría registrada, una validación online en los últimos 7 días y datos locales desbloqueables.';
    help.style.fontSize = '12px';
    help.style.opacity = '0.8';
    form.appendChild(button);
    form.appendChild(help);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installEntryButton, { once: true });
  } else {
    installEntryButton();
  }
})();
