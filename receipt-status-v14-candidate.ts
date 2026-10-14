import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.3'

const databaseUrl = Deno.env.get('SUPABASE_DB_URL')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!databaseUrl || !supabaseUrl || !serviceRoleKey) throw new Error('receipt_status_configuration_missing')
const db = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const enc = new TextEncoder()
const dec = new TextDecoder()
const BUCKET = 'sintergia-docs'
const MAX_REQUEST_BYTES = 64_000
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024
const MAX_RECEIPT_BASE64_CHARS = Math.ceil(MAX_RECEIPT_BYTES / 3) * 4
const RECEIPT_PATH = /^receipts\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{64}\.(?:jpg|png|webp|heic|pdf)$/

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
function b64e(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
function safeTokenPart(token: string): string {
  return token.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}
async function auth(req: Request): Promise<JsonObject | null> {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const parts = header.slice(7).split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  try {
    const rows = await db`select value from sintergia.server_secrets where name='session_hmac'`
    if (!rows.length) return null
    const key = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', key, b64d(parts[2]), enc.encode(parts[1]))) return null
    const payload: unknown = JSON.parse(dec.decode(b64d(parts[1])))
    return isObject(payload) && Number(payload.exp) > Date.now() / 1000 ? payload : null
  } catch {
    return null
  }
}
async function readJsonLimited(req: Request): Promise<JsonObject> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_REQUEST_BYTES) throw new RangeError('body_too_large')
  if (!req.body) throw new SyntaxError('empty_body')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new RangeError('body_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const parsed: unknown = JSON.parse(dec.decode(bytes))
  if (!isObject(parsed)) throw new SyntaxError('invalid_json_object')
  return parsed
}
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) },
  })
}
function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: cors(req) })
}
function errorName(error: unknown): string {
  return String((error as Error)?.message || error || '').slice(0, 120)
}
async function receiptBase64(token: string, metadata: unknown): Promise<{ file_base64?: string; file_error?: string }> {
  if (!isObject(metadata)) return { file_error: 'receipt_file_unavailable' }
  const bucket = String(metadata.bucket || '')
  const path = String(metadata.storage_path || '')
  const digest = String(metadata.sha256 || '').toLowerCase()
  const expectedPrefix = `receipts/${safeTokenPart(token)}/`
  const declaredSize = Number(metadata.size_bytes)
  if (bucket !== BUCKET || !path.startsWith(expectedPrefix) || !RECEIPT_PATH.test(path)
      || !/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(declaredSize)
      || declaredSize < 0 || declaredSize > MAX_RECEIPT_BYTES) {
    return { file_error: 'receipt_file_metadata_invalid' }
  }
  try {
    const { data, error } = await storage.storage.from(BUCKET).download(path)
    if (error || !data) return { file_error: 'receipt_file_unavailable' }
    if (data.size > MAX_RECEIPT_BYTES || data.size !== declaredSize) return { file_error: 'receipt_file_size_mismatch' }
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (await sha256Hex(bytes) !== digest) return { file_error: 'receipt_file_integrity_error' }
    return { file_base64: b64e(bytes) }
  } catch (error) {
    console.error('receipt_status_storage_error', errorName(error))
    return { file_error: 'receipt_file_unavailable' }
  }
}
async function legacyReceiptBase64(value: unknown): Promise<{ file_base64?: string; file_error?: string }> {
  const raw = typeof value === 'string' ? value.replace(/^data:[^,]+,/, '').trim() : ''
  if (!raw) return {}
  if (raw.length > MAX_RECEIPT_BASE64_CHARS || !/^[A-Za-z0-9+/=_-]+$/.test(raw) || raw.length % 4 === 1) {
    return { file_error: 'receipt_file_invalid' }
  }
  try {
    const bytes = b64d(raw)
    if (bytes.byteLength > MAX_RECEIPT_BYTES) return { file_error: 'receipt_file_too_large' }
    return { file_base64: b64e(bytes) }
  } catch {
    return { file_error: 'receipt_file_invalid' }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (!await auth(req)) return json(req, 401, { ok: false, error: 'unauthorized' })
  if (req.method === 'GET') {
    try {
      await db`select 1 from sintergia.receipt_tokens limit 1`
      return json(req, 200, { ok: true, service: 'receipt-status', configured: true, storageBucket: BUCKET })
    } catch {
      return json(req, 503, { ok: false, error: 'service_unavailable' })
    }
  }
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })

  let body: JsonObject
  try {
    body = await readJsonLimited(req)
  } catch (error) {
    if (error instanceof RangeError) return json(req, 413, { ok: false, error: 'request_too_large' })
    return json(req, 400, { ok: false, error: 'invalid_json' })
  }
  const tokens = Array.isArray(body.tokens)
    ? [...new Set(body.tokens.map(value => String(value ?? '').trim()).filter(value => value.length > 0 && value.length <= 160))].slice(0, 200)
    : []
  const facturaIds = Array.isArray(body.factura_ids)
    ? [...new Set(body.factura_ids.map(value => String(value ?? '').trim()).filter(value => value.length > 0 && value.length <= 160))].slice(0, 200)
    : []
  if (!tokens.length && !facturaIds.length) return json(req, 200, { ok: true, results: [] })
  const withFile = body.withFile === true

  try {
    const rows = await db`
      select token, factura_id, status, payload, updated_at
      from sintergia.receipt_tokens
      where token = any(${tokens}::text[])
         or factura_id = any(${facturaIds}::text[])
    `
    const results = []
    for (const row of rows as any[]) {
      const payload = isObject(row.payload) ? row.payload : {}
      const verification = isObject(payload.verification) ? payload.verification : {}
      const receipt = isObject(payload.receipt_file) ? payload.receipt_file : null
      let file = {}
      if (withFile) {
        file = receipt
          ? await receiptBase64(String(row.token), receipt)
          : await legacyReceiptBase64(payload.file_base64)
      }
      results.push({
        token: row.token,
        factura_id: row.factura_id,
        status: row.status,
        verified_at: verification.verified_at || row.updated_at,
        valido: verification.valido === true,
        referencia: verification.referencia || payload.referencia || '',
        importe: Number(verification.importe ?? payload.importe ?? 0) || 0,
        referenciaCoincide: verification.referenciaCoincide,
        importeCoincide: verification.importeCoincide,
        motivo: verification.motivo || '',
        filename: String(receipt?.filename || payload.filename || '').slice(0, 180),
        content_type: String(receipt?.content_type || payload.content_type || '').slice(0, 100),
        size_bytes: Number(receipt?.size_bytes || 0) || 0,
        receipt_available: Boolean(receipt?.storage_path || (typeof payload.file_base64 === 'string' && payload.file_base64.trim())),
        ...(withFile ? file : { file_base64: '' }),
      })
    }
    return json(req, 200, { ok: true, results })
  } catch (error) {
    console.error('receipt_status_error', errorName(error))
    return json(req, 503, { ok: false, error: 'service_unavailable' })
  }
})