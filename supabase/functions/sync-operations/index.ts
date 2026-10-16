import postgres from 'npm:postgres@3.4.3'
import { readJsonObjectLimited } from '../_shared/request-body.mjs'
import { validateSessionClaims } from '../_shared/session-claims.mjs'
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_REQUEST_BYTES = 5_500_000
let db: any = null
function sql() {
  if (!db) {
    const u = Deno.env.get('SUPABASE_DB_URL')
    if (!u) throw new Error('missing_db_url')
    db = postgres(u, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
  }
  return db
}
function b64d(s: string) {
  const pad = '='.repeat((4 - s.length % 4) % 4)
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const o = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i)
  return o
}
async function token(req: Request) {
  const h = req.headers.get('authorization') || ''
  if (!h.startsWith('Bearer ')) return null
  const p = h.slice(7).split('.')
  if (p.length !== 3 || p[0] !== 'v1') return null
  const rows = await sql()`select value from sintergia.server_secrets where name='session_hmac'`
  if (!rows.length) throw new Error('missing_session_hmac')
  try {
    const k = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', k, b64d(p[2]), enc.encode(p[1]))) return null
    const x = validateSessionClaims(JSON.parse(dec.decode(b64d(p[1]))))
    return x || null
  } catch { return null }
}
const DEFAULT_ALLOWED_ORIGINS = ['https://sintergiase-lgtm.github.io', 'https://sintergiase-app.pages.dev']
function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean)
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured].map(x => {
    try { return new URL(x).origin === x ? x : '' } catch { return '' }
  }).filter(Boolean))
  const h: any = { 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
  if (origin && allowed.has(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
function json(req: Request, status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } })
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })
  let t: any
  try { t = await token(req) } catch {
    return json(req, 503, { ok: false, error: 'auth_backend_unavailable', retryable: true })
  }
  if (!t) return json(req, 401, { ok: false, error: 'unauthorized' })
  try {
    let b: Record<string, unknown>
    try { b = await readJsonObjectLimited(req, MAX_REQUEST_BYTES) } catch (error) {
      return error instanceof RangeError ? json(req, 413, { ok: false, error: 'request_too_large' }) : json(req, 400, { ok: false, error: 'invalid_json' })
    }
    const rid = String(b?.requestId || req.headers.get('x-sintergia-request-id') || '')
    if (!rid || rid.length > 200) return json(req, 400, { ok: false, error: 'request_id_required' })
    const rawOp = b.operation
    const op = typeof rawOp === 'string' ? rawOp : String((rawOp as Record<string, unknown> | null)?.op || '')
    const payload = (b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload))
      ? b.payload as Record<string, unknown>
      : (rawOp && typeof rawOp === 'object' && !Array.isArray(rawOp) ? rawOp as Record<string, unknown> : {})

    // The current browser client sends upsert/delete operations and explicitly falls
    // back to the full snapshot when this optional endpoint returns 404/405. Never
    // acknowledge those mutations as applied here: v12 only logged them and did not
    // update app_state. This keeps the operation queue from silently losing changes.
    if (op !== 'snapshot') return json(req, 405, { ok: false, error: 'operation_endpoint_unsupported', fallback: 'snapshot' })
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
      return json(req, 405, { ok: false, error: 'snapshot_payload_required', fallback: 'snapshot' })
    }
    const state = payload.state as Record<string, unknown>
    const id = String(t.sub || '').trim()
    if (!id || id.length > 128) return json(req, 401, { ok: false, error: 'invalid_session_subject' })
    const s = sql()

    // A single DB transaction makes the request-id claim, state mutation and result atomic.
    // A concurrent duplicate waits on the unique key. If the first transaction rolls back,
    // the second can claim the ID; if it commits, the second reads its stored result.
    const outcome = await s.begin(async (tx: any) => {
      const claimed = await tx`
        insert into sintergia.sync_operations(request_id,actor_id,operation,payload,status)
        values(${rid},${id},${op},${s.json(payload)}::jsonb,'pending')
        on conflict (request_id) do nothing
        returning request_id`
      if (!claimed.length) {
        const existing = await tx`select actor_id,result,status,operation,payload,jsonb_typeof(payload) as payload_type,jsonb_typeof(result) as result_type, (operation <> ${op} or payload <> ${s.json(payload)}::jsonb) as mismatch from sintergia.sync_operations where request_id=${rid}`
        if (!existing.length) throw new Error('idempotency_record_unavailable')
        // Never return a stored result to another session subject. NULL actor_id means
        // the record predates actor binding; it must take the safe snapshot fallback.
        if (existing[0].actor_id == null) {
          return { duplicate: true, status: existing[0].status, incomplete: true, legacy: true }
        }
        if (String(existing[0].actor_id) !== id) {
          return { duplicate: true, conflict: true, status: existing[0].status }
        }
        // Before v14, payload/result could be JSONB strings and writes may have been
        // acknowledged without mutating app_state. Such rows are not proof of persistence.
        if (existing[0].payload_type !== 'object' || existing[0].result_type !== 'object') {
          return { duplicate: true, status: existing[0].status, incomplete: true, legacy: true }
        }
        // A request ID must identify one immutable operation and payload. Reusing it for
        // different content is a conflict, not a successful idempotent retry.
        if (existing[0].mismatch) return { duplicate: true, conflict: true, status: existing[0].status }
        if (existing[0].status === 'applied' && existing[0].result != null) {
          return { duplicate: true, status: existing[0].status, result: existing[0].result }
        }
        // Incomplete records require reconciliation; never issue a false acknowledgement.
        return { duplicate: true, status: existing[0].status, incomplete: true }
      }

      let result: any = { accepted: true, operation: op }
      const v = await tx`select sintergia.touch_app_state_v18(${id},${s.json(state)}::jsonb,${String(t.sub || '')}) as version`
      result = { ...result, id, version: Number(v[0].version) }
      await tx`update sintergia.sync_operations set result=${s.json(result)}::jsonb,status='applied',completed_at=now() where request_id=${rid}`
      return { duplicate: false, status: 'applied', result }
    })

    if (outcome.conflict) return json(req, 409, { ok: false, error: 'request_id_conflict' })
    if (outcome.incomplete) return json(req, 503, { ok: false, error: outcome.legacy ? 'legacy_sync_record_requires_reconciliation' : 'operation_incomplete', status: outcome.status, fallback: 'snapshot' })
    if (outcome.duplicate) return json(req, 200, { ok: true, idempotent: true, status: outcome.status, result: outcome.result })
    return json(req, 200, { ok: true, ...outcome.result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    if (message.includes('invalid_app_state')) return json(req, 400, { ok: false, error: 'invalid_app_state', retryable: false })
    return json(req, 503, { ok: false, error: 'sync_unavailable', retryable: true })
  }
})
