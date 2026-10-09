import postgres from 'npm:postgres@3.4.3'
const enc = new TextEncoder(), dec = new TextDecoder()
let _sql: any = null
export function getSql() {
  if (!_sql) {
    const url = Deno.env.get('SUPABASE_DB_URL')
    if (!url) throw new Error('missing_db_url')
    _sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
  }
  return _sql
}
const DEFAULT_ALLOWED_HEADERS = 'authorization, content-type, x-requested-with, x-sintergia-request-id, x-sintergia-health-check, apikey, x-client-info'
function allowedOrigin(origin: string): boolean {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
  return Boolean(origin) && allowed.includes(origin)
}
function allowedHeaders(req: Request): string {
  const requested = (req.headers.get('access-control-request-headers') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const safe = new Set(DEFAULT_ALLOWED_HEADERS.split(',').map(value => value.trim()))
  for (const header of requested) if (!safe.has(header) && !header.startsWith('x-sintergia-')) return DEFAULT_ALLOWED_HEADERS
  return requested.length ? requested.join(', ') : DEFAULT_ALLOWED_HEADERS
}
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': allowedHeaders(req),
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (origin && allowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}
export function preflight(req: Request) { return new Response(null, { status: 204, headers: corsHeaders(req) }) }
export function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req), ...extra } })
}
export function clientIp(req: Request) {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
}
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function b64url(bytes: Uint8Array) {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function b64urlDecode(value: string) {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const output = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i)
  return output
}
let _key: CryptoKey | null = null, _keyAt = 0
async function hmacKey() {
  if (_key && Date.now() - _keyAt < 10 * 60 * 1000) return _key
  const rows = await getSql()`select value from sintergia.server_secrets where name='session_hmac'`
  if (!rows.length) throw new Error('missing_session_secret')
  _key = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  _keyAt = Date.now()
  return _key
}
export async function issueToken(claims: Record<string, unknown>, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { ...claims, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() }
  const encoded = b64url(enc.encode(JSON.stringify(payload)))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(encoded)))
  return { token: 'v1.' + encoded + '.' + b64url(signature), expiresAt: payload.exp * 1000 }
}
export async function verifyToken(token: string) {
  const key = await hmacKey()
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1') return null
    const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), enc.encode(parts[1]))
    if (!valid) return null
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[1])))
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}
