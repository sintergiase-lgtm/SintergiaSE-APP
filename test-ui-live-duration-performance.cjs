'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['index.html', 'SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const script = html.match(/<script id="sintergia-horario-compras-js">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, `${file}: schedule module must exist`);
  assert.match(script, /setInterval\(\(\)=>\{if\(!document\.hidden\)updateLiveDurations\(\);check8h\(\)\},1000\)/,
    `${file}: one-second updates must only refresh durations and the eight-hour alert`);
  assert.doesNotMatch(script, /setInterval\(\(\)=>\{render\(\);check8h\(\)\},1000\)/,
    `${file}: the full table must not be rebuilt on every clock tick`);
  assert.match(script, /setInterval\(\(\)=>\{if\(document\.hidden\)return;fillParts\(\);renderCompras\(\);render\(\)\},15000\)/,
    `${file}: non-time UI state keeps a bounded refresh while visible`);

  const start = script.indexOf('function updateLiveDurations(){');
  const end = script.indexOf('\nfunction render(){', start);
  assert.ok(start >= 0 && end > start, `${file}: incremental duration updater must exist`);
  const nodes = [
    { value: '1000', textContent: '', getAttribute() { return this.value; } },
    { value: 'not-a-time', textContent: 'unchanged', getAttribute() { return this.value; } }
  ];
  const fixedDate = class extends Date { static now() { return 5000; } };
  const context = {
    Date: fixedDate,
    Number,
    fmtDur: value => `duration:${value}`,
    document: { querySelectorAll: () => nodes }
  };
  vm.createContext(context);
  vm.runInContext(`${script.slice(start, end)}\nupdateLiveDurations();`, context);
  assert.equal(nodes[0].textContent, 'duration:4000', `${file}: active duration is updated in place`);
  assert.equal(nodes[1].textContent, 'unchanged', `${file}: malformed duration metadata is ignored`);
  console.log(`PASS: ${file} incremental live-duration updates avoid full table reflows`);
}
