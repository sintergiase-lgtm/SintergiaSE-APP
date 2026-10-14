'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = [
  'index.html',
  'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html',
];

function createHarness({ failLocalStorage = false, failSessionStorage = false, missingModal = false, missingCanvas = false } = {}) {
  const persisted = new Map();
  const strokes = [];
  const cleared = [];
  const ignoredErrors = [];
  const ctx = {
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { strokes.push(true); },
    clearRect(...args) { cleared.push(args); },
  };
  const canvas = {
    clientWidth: 320,
    clientHeight: 140,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 140 }),
    getContext: () => ctx,
    setPointerCapture() {},
    toDataURL: () => 'data:image/png;base64,synthetic-test-signature',
  };
  const modal = { style: { display: 'none' } };
  const info = { innerHTML: '' };
  const clearButton = {};
  const saveButton = {};
  const error = { textContent: '' };
  const elements = {
    'modal-firma-tecnico': modal,
    'technician-signature-pad': canvas,
    'tecnico-identidad-resumen': info,
    'technician-signature-clear': clearButton,
    'technician-signature-save': saveButton,
    'technician-signature-error': error,
  };
  if (missingModal) delete elements['modal-firma-tecnico'];
  if (missingCanvas) delete elements['technician-signature-pad'];

  const sandbox = {
    esc: value => String(value == null ? '' : value),
    document: { getElementById: id => elements[id] || null },
    window: {
      devicePixelRatio: 2,
      SintergiaTechnician: { nombre: 'Técnico de prueba', dni: 'DNI-TEST' },
      __sgIgn: e => ignoredErrors.push(e),
    },
    localStorage: {
      setItem(key, value) {
        if (failLocalStorage) throw new Error('local storage unavailable');
        persisted.set(`local:${key}`, value);
      },
    },
    sessionStorage: {
      setItem(key, value) {
        if (failSessionStorage) throw new Error('session storage unavailable');
        persisted.set(`session:${key}`, value);
      },
    },
  };
  return { sandbox, canvas, modal, clearButton, saveButton, error, persisted, strokes, cleared, ignoredErrors };
}

function loadSignatureFlow(source, sandbox) {
  const start = source.indexOf('function abrirFirmaTecnicoDelDia()');
  const end = source.indexOf('/* --- PASO 4: jornada obligatoria --- */', start);
  assert.ok(start >= 0 && end > start, 'signature flow boundaries must exist');
  return vm.runInNewContext(`${source.slice(start, end)}\nabrirFirmaTecnicoDelDia();`, sandbox);
}

function drawStroke(canvas) {
  canvas.onpointerdown({ clientX: 12, clientY: 16, pointerId: 1 });
  canvas.onpointermove({ clientX: 22, clientY: 25, pointerId: 1 });
  canvas.onpointerup();
}

function loadAccessFinalizer(source, sandbox) {
  const start = source.indexOf('async function finalizarAcceso(modo)');
  const end = source.indexOf('function initAccess()', start);
  assert.ok(start >= 0 && end > start, 'access finalizer boundaries must exist');
  return vm.runInNewContext(`${source.slice(start, end)}\nfinalizarAcceso('tecnico');`, sandbox);
}

async function assertMissingSignatureFailsClosed(source, page) {
  let jornadaStarted = false, geoStarted = false, toastShown = false;
  const classes = [];
  const gate = { style: { display: 'none' }, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
  const sandbox = {
    window: {
      __sgIgn() {},
      aplicarModoSintergia() {},
      SintergiaGeo: { iniciar() { geoStarted = true; } },
      mostrarToast() { toastShown = true; },
    },
    document: { body: { classList: { add(value) { classes.push(`add:${value}`); }, remove(value) { classes.push(`remove:${value}`); } } } },
    sessionStorage: { setItem() {} },
    gate,
    errorId: { textContent: '' },
    ETIQUETAS: { tecnico: 'Técnico' },
    mostrarAnimacionCorrecto: async () => {},
    prepararEntorno() {},
    abrirFirmaTecnicoDelDia: async () => false,
    exigirInicioJornada: async () => { jornadaStarted = true; },
  };
  const result = await loadAccessFinalizer(source, sandbox);
  assert.equal(result, false, `${page}: missing signature UI must reject access completion`);
  assert.equal(gate.style.display, 'flex');
  assert.equal(gate.attrs['aria-hidden'], 'false');
  assert.ok(classes.includes('add:sintergia-locked'));
  assert.match(sandbox.errorId.textContent, /firma obligatoria no está disponible/i);
  assert.equal(jornadaStarted, false);
  assert.equal(geoStarted, false);
  assert.equal(toastShown, false);
}

async function assertPending(promise) {
  let settled = false;
  promise.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'signature flow must remain pending after a rejected save');
}

async function runPage(page) {
  const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
  await assertMissingSignatureFailsClosed(source, page);

  for (const options of [{ missingModal: true }, { missingCanvas: true }]) {
    const h = createHarness(options);
    const completion = loadSignatureFlow(source, h.sandbox);
    assert.equal(await completion, false, `${page}: missing signature UI must not count as success`);
    assert.equal(h.persisted.size, 0);
  }

  {
    const h = createHarness();
    const completion = loadSignatureFlow(source, h.sandbox);
    h.canvas.onpointerdown({ clientX: 12, clientY: 16, pointerId: 1 });
    h.canvas.onpointerup();
    h.saveButton.onclick();
    await assertPending(completion);
    assert.match(h.error.textContent, /Firma requerida/);
    assert.equal(h.strokes.length, 0, 'a click without a drawn stroke is not a signature');
    assert.equal(h.persisted.size, 0);
    assert.equal(h.sandbox.window.SintergiaTechnicianSignature, undefined);
  }

  {
    const h = createHarness();
    const completion = loadSignatureFlow(source, h.sandbox);
    drawStroke(h.canvas);
    h.saveButton.onclick();
    assert.equal(await completion, true);
    assert.equal(h.strokes.length, 1);
    assert.equal(h.persisted.get('session:sintergia_horario_auth'), '1');
    const saved = JSON.parse(h.persisted.get('local:sintergia_tecnico_firma_dia_v1'));
    assert.equal(saved.dataUrl, 'data:image/png;base64,synthetic-test-signature');
    assert.equal(h.sandbox.window.SintergiaTechnicianSignature.dataUrl, saved.dataUrl);
    assert.equal(h.modal.style.display, 'none');
  }

  {
    const h = createHarness();
    const completion = loadSignatureFlow(source, h.sandbox);
    drawStroke(h.canvas);
    h.clearButton.onclick();
    h.saveButton.onclick();
    await assertPending(completion);
    assert.equal(h.cleared.length, 1);
    assert.match(h.error.textContent, /Firma requerida/);
    assert.equal(h.persisted.size, 0);
  }

  for (const failure of ['local', 'session']) {
    const h = createHarness({
      failLocalStorage: failure === 'local',
      failSessionStorage: failure === 'session',
    });
    const completion = loadSignatureFlow(source, h.sandbox);
    drawStroke(h.canvas);
    h.saveButton.onclick();
    await assertPending(completion);
    assert.match(h.error.textContent, /No se pudo guardar la firma/);
    assert.equal(h.sandbox.window.SintergiaTechnicianSignature, undefined);
    assert.equal(h.persisted.has('session:sintergia_horario_auth'), false);
    assert.equal(h.modal.style.display, 'flex');
    assert.equal(h.ignoredErrors.length, 1);
  }
}

(async () => {
  for (const page of pages) await runPage(page);
  console.log(`PASS: synthetic technician signature flow (${pages.length} pages)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

