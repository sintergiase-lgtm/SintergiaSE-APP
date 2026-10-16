'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const snapshot = fs.readFileSync('supabase/functions/realtime-snapshot/index.ts', 'utf8');
const sync = fs.readFileSync('supabase/functions/sync-operations/index.ts', 'utf8');

// postgres.js must receive typed JSON values. Binding JSON.stringify(value) as a
// parameter casts a JSON string scalar to jsonb instead of the intended object.
assert.match(snapshot, /\$\{d\.json\(state\)\}\s*::jsonb/);
assert.match(sync, /\$\{s\.json\(payload\)\}\s*::jsonb/);
assert.match(sync, /\$\{s\.json\(state\)\}\s*::jsonb/);
assert.match(sync, /\$\{s\.json\(result\)\}\s*::jsonb/);
assert.doesNotMatch(snapshot, /\$\{\s*JSON\.stringify\(/);
assert.doesNotMatch(sync, /\$\{\s*JSON\.stringify\(/);

process.stdout.write('Supabase JSONB bindings use typed JSON values.\\n');
