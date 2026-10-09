import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.3'

const dbUrl = Deno.env.get('SUPABASE_DB_URL')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!dbUrl || !supabaseUrl || !serviceRoleKey) throw new Error('storage_or_database_configuration_missing')
const db = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_BINARY_BYTES = 25 * 1024 * 1024
const MAX_BASE64_CHARS = Math.ceil(MAX_BINARY_BYTES / 3) * 4 + 4
const MAX_REQUEST_BYTES = MAX_BASE64_CHARS + 64_000

function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
async function session(req: Request): Promise<any | null> {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const parts = header.slice(7).split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  try {
    const rows = await db`select value from sintergia.server_secrets where name='session_hmac'`
    if (!rows.length) return null
    const key = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', key, b64d(parts[2]), enc.encode(parts[1]))) return null
    const payload = JSON.parse(dec.decode(b64d(parts[1])))
    return Number(payload?.exp) > Date.now() / 1000 ? payload : null
  } catch { return null }
}
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  }
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } })
}
function preflight(req: Request): Response { return new Response(null, { status: 204, headers: cors(req) }) }
async function readJsonLimited(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_REQUEST_BYTES) throw new RangeError('body_too_large')
  if (!req.body) throw new SyntaxError('empty_body')
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) { await reader.cancel().catch(() => undefined); throw new RangeError('body_too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const parsed: unknown = JSON.parse(dec.decode(bytes))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json')
  return parsed as Record<string, unknown>
}

const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })
  const currentSession = await session(req)
  if (!currentSession) return json(req, 401, { ok: false, error: 'unauthorized' })
  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? json(req, 413, { ok: false, error: 'request_too_large' })
      : json(req, 400, { ok: false, error: 'invalid_json' })
  }
  const token = String(body.token ?? '').trim().slice(0, 200)
  const content = String(body.content ?? body.data ?? '')
  const name = String(body.name ?? body.filename ?? 'recibo').trim().slice(0, 180)
  const mime = String(body.mime ?? body.contentType ?? 'application/octet-stream').trim().slice(0, 120)
  if (!token || !content) return json(req, 400, { ok: false, error: 'invalid_receipt' })
  const base64 = content.replace(/^data:[^;]+;base64,/, '').trim()
  if (base64.length > MAX_BASE64_CHARS) return json(req, 413, { ok: false, error: 'receipt_too_large' })
  if (!/^[A-Za-z0-9+/=_-]+$/.test(base64) || base64.length % 4 === 1) return json(req, 400, { ok: false, error: 'invalid_base64' })
  let bytes: Uint8Array
  try { bytes = b64d(base64) } catch { return json(req, 400, { ok: false, error: 'invalid_base64' }) }
  if (bytes.byteLength > MAX_BINARY_BYTES) return json(req, 413, { ok: false, error: 'receipt_too_large' })

  let path = ''
  try {
    const rows = await db`select token from sintergia.receipt_tokens where token=${token}`
    if (!rows.length) return json(req, 404, { ok: false, error: 'unknown_token' })
    const id = crypto.randomUUID()
    const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'recibo'
    const safeToken = token.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)
    path = `receipts/${safeToken}/${id}-${safeName}`
    const uploaded = await storage.storage.from('sintergia-docs').upload(path, bytes, { contentType: mime, upsert: false })
    if (uploaded.error) return json(req, 502, { ok: false, error: 'storage_upload_failed' })
    try {
      await db.begin(async (tx: any) => {
        await tx`
          insert into sintergia.document_uploads(id,kind,token,original_name,mime_type,size_bytes,storage_path)
          values(${id},'receipt',${token},${name},${mime},${bytes.byteLength},${path})
        `
        await tx`
          update sintergia.receipt_tokens
          set payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{uploaded}',to_jsonb(true),true),
              status='received', updated_at=now()
          where token=${token}
        `
      })
    } catch (error) {
      await storage.storage.from('sintergia-docs').remove([path]).catch(() => undefined)
      throw error
    }
    return json(req, 200, { ok: true, id, token, name, mime, size: bytes.byteLength, stored: true, bucket: 'sintergia-docs', path })
  } catch (error) {
    console.error('upload_receipt_error', String(error))
    return json(req, 503, { ok: false, error: 'service_unavailable' })
  }
})
