'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pages = [
  'index.html',
  'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html',
];

for (const page of pages) {
  const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const start = source.indexOf('window.aplicarSnapshotSincronizacion=function(snapshot){');
  const end = source.indexOf('window.probarSincronizacionMultidispositivo', start);
  assert.ok(start >= 0 && end > start, `${page}: snapshot applier exists`);

  const applier = source.slice(start, end);
  assert.match(
    applier,
    /guardarEstadoStorage\(\)===false\)return false;/,
    `${page}: storage failure must prevent a successful snapshot ACK`,
  );

  assert.match(
    source,
    /if\(!applied\)ultimoHash='';syncToast\(applied\?/,
    `${page}: periodic sync must report persistence failure and retry later`,
  );
  assert.match(
    source,
    /if\(typeof window\.aplicarSnapshotSincronizacion!=='function'\|\|window\.aplicarSnapshotSincronizacion\(prepared\)!==true\)throw new Error/,
    `${page}: backup merge must stop unless the snapshot was persisted`,
  );
  assert.match(source, /fusionarCopiaImportada\(snap\)/, `${page}: backup import must use the guarded merge`);
}

console.log('PASS: snapshot and backup imports fail closed on local persistence errors');
