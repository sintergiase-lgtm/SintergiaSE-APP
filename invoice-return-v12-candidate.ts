import postgres from 'npm:postgres@3.4.3'

const databaseUrl = Deno.env.get('SUPABASE_DB_URL')
if (!databaseUrl) throw new Error('missing_db_url')
const db = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const MAX_REQUEST_BYTES = 256_000
const MAX_ATTACHMENTS = 20
const MAX_ATTACHMENT_TEXT = 160_000

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
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('invalid_json')
  return value as Record<string, unknown>
}
function sanitizeAttachments(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null
  let textBytes = 0
  for (const item of value) {
    const serialized = JSON.stringify(item)
    if (serialized === undefined) return null
    textBytes += new TextEncoder().encode(serialized).byteLength
    if (textBytes > MAX_ATTACHMENT_TEXT) return null
    if (item && typeof item === 'object') {
      for (const [key, field] of Object.entries(item as Record<string, unknown>)) {
        if (key.length > 80) return null
        if (typeof field === 'string' && field.length > MAX_ATTACHMENT_TEXT) return null
      }
    }
  }
  return value
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })
  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? json(req, 413, { ok: false, error: 'request_too_large' })
      : json(req, 400, { ok: false, error: 'invalid_json' })
  }
  const token = String(body.token ?? '').trim().slice(0, 200)
  const reason = String(body.motivo ?? '').trim().slice(0, 4000)
  if (!token) return json(req, 400, { ok: false, error: 'invalid_token' })
  if (typeof body.archivos !== 'undefined' && !Array.isArray(body.archivos)) return json(req, 400, { ok: false, error: 'invalid_attachments' })
  const attachments = sanitizeAttachments(body.archivos ?? [])
  if (!attachments) return json(req, 413, { ok: false, error: 'attachments_too_large_or_invalid' })

  try {
    const result = await db.begin(async (tx: any) => {
      const exists = await tx`select token from sintergia.receipt_tokens where token=${token} for update`
      if (!exists.length) return { status: 404, body: { ok: false, error: 'invalid_receipt_token' } }
      await tx`
        insert into sintergia.invoice_returns(token,motivo,archivos)
        values(${token},${reason},${JSON.stringify(attachments)})
        on conflict(token) do update
          set motivo=excluded.motivo, archivos=excluded.archivos, status='received', updated_at=now()
      `
      await tx`
        update sintergia.receipt_tokens
        set status='received', payload=coalesce(payload, '{}'::jsonb) || jsonb_build_object('returnReceived',true), updated_at=now()
        where token=${token}
      `
      return { status: 200, body: { ok: true, status: 'received' } }
    })
    return json(req, result.status, result.body)
  } catch (error) {
    console.error('invoice_return_error', String(error))
    return json(req, 503, { ok: false, error: 'service_unavailable' })
  }
})
