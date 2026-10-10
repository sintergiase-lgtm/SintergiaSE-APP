import postgres from 'npm:postgres@3.4.3'

const enc = new TextEncoder()
const dec = new TextDecoder()
const MAX_REQUEST_BYTES = 5_500_000
const DEFAULT_ALLOWED_ORIGINS = new Set(['https://sintergiase-lgtm.github.io'])
let db: any = null

function sql() {
  if (!db) {
    const url = Deno.env.get('SUPABASE_DB_URL')
    if (!url) throw new Error('missing_db_url')
    db = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
  }
  return db
}

function b64urlDecode(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function verifySession(req: Request): Promise<Record<string, unknown> | null> {
  const authorization = req.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ')) return null

  const parts = authorization.slice(7).split('.')
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return null

  let claims: unknown
  try {
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])))
  } catch {
    return null
  }
  if (!isRecord(claims)
      || typeof claims.sub !== 'string' || !claims.sub.trim()
      || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
      || claims.exp <= Date.now() / 1000) return null

  // Infrastructure errors must remain 503, not be disguised as an invalid user token.
  const rows = await sql()`select value from sintergia.server_secrets where name='session_hmac'`
  if (!rows.length || !String(rows[0].value || '')) throw new Error('missing_session_secret')
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), enc.encode(parts[1]))
  } catch {
    return null
  }
  return valid ? claims : null
}

function allowedOrigins(): Set<string> {
  const extras = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',')
    .map(value => value.trim())
    .filter(value => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' && parsed.origin === value
      } catch {
        return false
      }
    })
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras])
}

function cors(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') || '').trim()
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  // No wildcard and no arbitrary origin reflection. Add other exact HTTPS origins only
  // when confirmed for a real deployment (for example, a separately hosted WebView).
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors(req),
    },
  })
}

async function readJsonLimited(req: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BYTES) throw new RangeError('request_too_large')
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
        throw new RangeError('request_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const parsed: unknown = JSON.parse(dec.decode(bytes))
  if (!isRecord(parsed)) throw new SyntaxError('invalid_json')
  return parsed
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })

  let claims: Record<string, unknown> | null
  try {
    claims = await verifySession(req)
  } catch {
    return json(req, 503, { ok: false, error: 'auth_verification_unavailable' })
  }
  if (!claims) return json(req, 401, { ok: false, error: 'unauthorized' })

  try {
    let body: Record<string, unknown>
    try {
      body = await readJsonLimited(req)
    } catch (error) {
      return error instanceof RangeError
        ? json(req, 413, { ok: false, error: 'request_too_large' })
        : json(req, 400, { ok: false, error: 'invalid_json' })
    }

    const requestId = String(body.requestId || req.headers.get('x-sintergia-request-id') || '')
    if (!requestId || requestId.length > 200) {
      return json(req, 400, { ok: false, error: 'request_id_required' })
    }

    const rawOperation = body.operation
    const operation = typeof rawOperation === 'string'
      ? rawOperation
      : String((isRecord(rawOperation) && rawOperation.op) || '')
    const payload = isRecord(body.payload)
      ? body.payload
      : (isRecord(rawOperation) ? rawOperation : {})

    // This endpoint only persists full snapshots. The client currently sends upsert/delete
    // deltas here, so returning 405 is intentional: it activates the documented snapshot
    // fallback instead of falsely acknowledging deltas that were never applied.
    if (operation !== 'snapshot') {
      return json(req, 405, { ok: false, error: 'operation_endpoint_unsupported', fallback: 'snapshot' })
    }
    if (!isRecord(payload.state)) {
      return json(req, 405, { ok: false, error: 'snapshot_payload_required', fallback: 'snapshot' })
    }

    const state = payload.state
    const stateId = String(payload.id || claims.sub || '').trim()
    if (!stateId || stateId.length > 128) {
      return json(req, 400, { ok: false, error: 'invalid_state_id' })
    }

    const database = sql()
    // Claim requestId, update snapshot and persist acknowledgement in one transaction.
    // A concurrent duplicate waits for the first transaction and then returns its result.
    const outcome = await database.begin(async (tx: any) => {
      const claimed = await tx`
        insert into sintergia.sync_operations(request_id,operation,payload,status)
        values(${requestId},${operation},${JSON.stringify(payload)}::jsonb,'pending')
        on conflict (request_id) do nothing
        returning request_id`

      if (!claimed.length) {
        const existing = await tx`
          select result,status,
            (operation <> ${operation} or payload <> ${JSON.stringify(payload)}::jsonb) as mismatch
          from sintergia.sync_operations where request_id=${requestId}`
        if (!existing.length) throw new Error('idempotency_record_unavailable')
        if (existing[0].mismatch) return { duplicate: true, conflict: true, status: existing[0].status }
        if (existing[0].status === 'applied' && existing[0].result != null) {
          return { duplicate: true, status: existing[0].status, result: existing[0].result }
        }
        return { duplicate: true, incomplete: true, status: existing[0].status }
      }

      const versionRows = await tx`
        select sintergia.touch_app_state(
          ${stateId},${JSON.stringify(state)}::jsonb,${String(claims.sub)}
        ) as version`
      const result = { accepted: true, operation, id: stateId, version: Number(versionRows[0].version) }
      await tx`
        update sintergia.sync_operations
        set result=${JSON.stringify(result)}::jsonb,status='applied',completed_at=now()
        where request_id=${requestId}`
      return { duplicate: false, status: 'applied', result }
    })

    if (outcome.conflict) return json(req, 409, { ok: false, error: 'request_id_conflict' })
    if (outcome.incomplete) return json(req, 503, { ok: false, error: 'operation_incomplete', status: outcome.status })
    if (outcome.duplicate) return json(req, 200, { ok: true, idempotent: true, status: outcome.status, result: outcome.result })
    return json(req, 200, { ok: true, ...outcome.result })
  } catch (error) {
    console.error('sync_operations_failed', String((error as Error)?.message || error))
    return json(req, 503, { ok: false, error: 'sync_unavailable', retryable: true })
  }
})
