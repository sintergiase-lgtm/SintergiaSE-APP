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
const PRODUCTION_BACKEND_HOST = 'bgjicsowspppsjzigazb.supabase.co';
const PREVIEW_BACKEND_HOST = 'sintergiase-preview-backend.invalid';
const IS_CLOUDFLARE_BUILD = process.env.CF_PAGES === '1';
const PAGES_BRANCH = process.env.CF_PAGES_BRANCH;
if (IS_CLOUDFLARE_BUILD && (!PAGES_BRANCH || PAGES_BRANCH.trim() === '')) {
  throw new Error('CF_PAGES_BRANCH is required; refusing an unisolated Pages build');
}
const IS_PREVIEW_BUILD = IS_CLOUDFLARE_BUILD && PAGES_BRANCH !== 'main';
let replacedBackendReferences = 0;

function isolatePreviewBackend(content) {
  if (!IS_PREVIEW_BUILD) return content;
  replacedBackendReferences += content.split(PRODUCTION_BACKEND_HOST).length - 1;
  return content.replaceAll(PRODUCTION_BACKEND_HOST, PREVIEW_BACKEND_HOST);
}
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

const sourceHtml = readFileSync(SOURCE, 'utf8');
const original = isolatePreviewBackend(sourceHtml);
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
  const destination = join(OUTPUT, name);
  if (IS_PREVIEW_BUILD && !name.endsWith('.png')) {
    writeFileSync(destination, isolatePreviewBackend(readFileSync(path, 'utf8')), 'utf8');
  } else {
    copyFileSync(path, destination);
  }
}

if (IS_PREVIEW_BUILD) {
  if (replacedBackendReferences === 0) {
    throw new Error('Preview build did not find a production backend reference to isolate');
  }
  const assetsDir = join(OUTPUT, 'assets');
  const textAssets = [
    join(OUTPUT, 'index.html'),
    ...RUNTIME_FILES.filter(name => !name.endsWith('.png')).map(name => join(OUTPUT, name)),
    ...readdirSync(assetsDir)
      .filter(name => name.endsWith('.js'))
      .map(name => join(assetsDir, name)),
  ];
  for (const path of textAssets) {
    if (readFileSync(path, 'utf8').includes(PRODUCTION_BACKEND_HOST)) {
      throw new Error('Preview artifact contains the production Supabase host: ' + path);
    }
  }
}

const beforeBytes = Buffer.byteLength(original);
const afterBytes = Buffer.byteLength(html);
if (assets.size === 0 || afterBytes >= beforeBytes) {
  throw new Error('Static build did not reduce the HTML payload');
}
console.log(
  'Static build ready: ' + assets.size + ' images and ' + inlineScriptCount + ' inline scripts externalized (' + inlineScripts.size + ' JS assets); HTML ' +
  beforeBytes + ' -> ' + afterBytes + ' bytes; assets ' + extractedBytes + ' bytes; backend mode ' + (IS_PREVIEW_BUILD ? 'isolated preview' : 'production-compatible') + '.'
);
