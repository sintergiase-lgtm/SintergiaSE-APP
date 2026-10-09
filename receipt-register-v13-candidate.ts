import postgres from 'npm:postgres@3.4.3'

const databaseUrl = Deno.env.get('SUPABASE_DB_URL')
if (!databaseUrl) throw new Error('missing_db_url')
const db = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_REQUEST_BYTES = 64_000

function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
async function auth(req: Request): Promise<any | null> {
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json')
  return parsed as Record<string, unknown>
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight(req)
  const session = await auth(req)
  if (!session) return json(req, 401, { ok: false, error: 'unauthorized' })
  if (req.method === 'GET') {
    try {
      await db`select 1 from sintergia.receipt_tokens limit 1`
      return json(req, 200, { ok: true, service: 'receipt-register', configured: true })
    } catch { return json(req, 503, { ok: false, error: 'service_unavailable' }) }
  }
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })

  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? json(req, 413, { ok: false, error: 'request_too_large' })
      : json(req, 400, { ok: false, error: 'invalid_json' })
  }
  const token = String(body.token ?? '').trim().slice(0, 200)
  const facturaId = String(body.facturaId ?? '').trim().slice(0, 160)
  const cliente = String(body.cliente ?? '').trim().slice(0, 200)
  const importe = body.importe === null || body.importe === undefined || body.importe === '' ? null : Number(body.importe)
  if (!token || !facturaId) return json(req, 400, { ok: false, error: 'invalid_request' })
  if (importe !== null && (!Number.isFinite(importe) || importe < 0)) return json(req, 400, { ok: false, error: 'invalid_amount' })

  try {
    const outcome = await db.begin(async (tx: any) => {
      const inserted = await tx`
        insert into sintergia.receipt_tokens(token,factura_id,importe,cliente,status,payload)
        values(${token},${facturaId},${importe},${cliente},'pending',${JSON.stringify({ registeredBy: session.sub || 'session', registeredAt: new Date().toISOString() })}::jsonb)
        on conflict(token) do nothing
        returning token,factura_id,importe,cliente,status
      `
      if (inserted.length) return { status: 201, body: { ok: true, token, factura_id: facturaId, status: 'pending', created: true } }
      const existing = await tx`select token,factura_id,importe,cliente,status from sintergia.receipt_tokens where token=${token} for update`
      if (!existing.length) return { status: 503, body: { ok: false, error: 'registration_retry' } }
      const row = existing[0]
      const sameAmount = row.importe === null && importe === null || row.importe !== null && importe !== null && Math.abs(Number(row.importe) - importe) < 0.005
      const identical = String(row.factura_id) === facturaId && sameAmount && String(row.cliente || '') === cliente
      if (!identical) return { status: 409, body: { ok: false, error: 'token_conflict' } }
      return { status: 200, body: { ok: true, token, factura_id: facturaId, status: row.status, created: false, idempotent: true } }
    })
    return json(req, outcome.status, outcome.body)
  } catch (error) {
    console.error('receipt_register_error', String(error))
    return json(req, 503, { ok: false, error: 'service_unavailable' })
  }
})
