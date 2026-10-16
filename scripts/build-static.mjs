import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'index.html');
const outputArg = process.argv[2] || 'dist';
const OUTPUT = resolve(ROOT, outputArg);
const MIN_IMAGE_BYTES = 8192;
const RUNTIME_FILES = [
  '_headers',
  'sw.js',
  'manifest.webmanifest',
  'offline-guard.js',
  'offline-login-bridge.js',
  'icon-192.png',
  'icon-512.png',
];

if (!existsSync(SOURCE)) throw new Error('index.html is missing');
if (OUTPUT === ROOT || OUTPUT.startsWith(ROOT + '/.git')) {
  throw new Error('Refusing to use the repository root or .git as output');
}
if (existsSync(OUTPUT) && readdirSync(OUTPUT).length > 0) {
  throw new Error('Output directory must be empty: ' + OUTPUT);
}
mkdirSync(join(OUTPUT, 'assets'), { recursive: true });

const original = readFileSync(SOURCE, 'utf8');
const assets = new Map();
let extractedBytes = 0;
const imageSrc = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([^"']+)\2/gi;
const imageOptimizedHtml = original.replace(imageSrc, (whole, prefix, quote, mime, payload) => {
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length < MIN_IMAGE_BYTES) return whole;
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== payload.replace(/\s/g, '').replace(/=+$/, '')) {
    throw new Error('Invalid inline image payload');
  }
  const extension = mime.toLowerCase() === 'image/jpeg' || mime.toLowerCase() === 'image/jpg'
    ? 'jpg'
    : mime.toLowerCase().slice('image/'.length);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const name = 'inline-' + hash + '.' + extension;
  assets.set(name, bytes);
  extractedBytes += bytes.length;
  return prefix + quote + './assets/' + name + quote;
});

const inlineScripts = new Set();
let inlineScriptCount = 0;
const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const html = imageOptimizedHtml.replace(scriptTag, (whole, attributes, body) => {
  if (/\bsrc\s*=/.test(attributes)) return whole;
  const type = (attributes.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || 'text/javascript';
  if (!/(?:java|ecma)script/i.test(type)) return whole;
  if (/\b(?:async|defer|nomodule)\b/i.test(attributes)) {
    throw new Error('Refusing to change inline script scheduling semantics');
  }
  const name = 'script-' + createHash('sha256').update(body).digest('hex') + '.js';
  if (!inlineScripts.has(name)) {
    writeFileSync(join(OUTPUT, 'assets', name), body, 'utf8');
    inlineScripts.add(name);
  }
  inlineScriptCount++;
  return '<script' + attributes + ' defer src="./assets/' + name + '"></script>';
});
if (inlineScriptCount === 0) throw new Error('No inline JavaScript was externalized');


for (const [name, bytes] of assets) {
  writeFileSync(join(OUTPUT, 'assets', name), bytes, { flag: 'wx' });
}
writeFileSync(join(OUTPUT, 'index.html'), html, 'utf8');

for (const name of RUNTIME_FILES) {
  const path = join(ROOT, name);
  if (!existsSync(path)) throw new Error('Required app asset is missing: ' + name);
  copyFileSync(path, join(OUTPUT, name));
}

const beforeBytes = Buffer.byteLength(original);
const afterBytes = Buffer.byteLength(html);
if (assets.size === 0 || afterBytes >= beforeBytes) {
  throw new Error('Static build did not reduce the HTML payload');
}
console.log(
  'Static build ready: ' + assets.size + ' images and ' + inlineScriptCount + ' inline scripts externalized (' + inlineScripts.size + ' JS assets); HTML ' +
  beforeBytes + ' -> ' + afterBytes + ' bytes; assets ' + extractedBytes + ' bytes.'
);
