import postgres from 'npm:postgres@3.4.3'
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
  try {
    const rows = await sql()`select value from sintergia.server_secrets where name='session_hmac'`
    if (!rows.length) return null
    const k = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', k, b64d(p[2]), enc.encode(p[1]))) return null
    const x = JSON.parse(dec.decode(b64d(p[1])))
    return x.exp > Date.now() / 1000 ? x : null
  } catch { return null }
}
function cors(req: Request) {
  const o = req.headers.get('origin'), a = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean)
  const h: any = { 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
  if (o && (!a.length || a.includes(o))) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Credentials'] = 'true' }
  return h
}
function json(req: Request, status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } })
}
async function readJsonLimited(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_REQUEST_BYTES) throw new RangeError('request_too_large')
  if (!req.body) throw new SyntaxError('empty_body')
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) { await reader.cancel().catch(() => undefined); throw new RangeError('request_too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const parsed: unknown = JSON.parse(dec.decode(bytes))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json')
  return parsed as Record<string, unknown>
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })
  const t = await token(req)
  if (!t) return json(req, 401, { ok: false, error: 'unauthorized' })
  try {
    let b: Record<string, unknown>
    try { b = await readJsonLimited(req) } catch (error) {
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
    const id = String(payload.id || t.sub || 'default').trim()
    if (!id || id.length > 128) return json(req, 400, { ok: false, error: 'invalid_state_id' })
    const s = sql()

    // A single DB transaction makes the request-id claim, state mutation and result atomic.
    // A concurrent duplicate waits on the unique key. If the first transaction rolls back,
    // the second can claim the ID; if it commits, the second reads its stored result.
    const outcome = await s.begin(async (tx: any) => {
      const claimed = await tx`
        insert into sintergia.sync_operations(request_id,operation,payload,status)
        values(${rid},${op},${JSON.stringify(payload)}::jsonb,'pending')
        on conflict (request_id) do nothing
        returning request_id`
      if (!claimed.length) {
        const existing = await tx`select result,status, (operation <> ${op} or payload <> ${JSON.stringify(payload)}::jsonb) as mismatch from sintergia.sync_operations where request_id=${rid}`
        if (!existing.length) throw new Error('idempotency_record_unavailable')
        // A request ID must identify one immutable operation and payload. Reusing it for
        // different content is a conflict, not a successful idempotent retry.
        if (existing[0].mismatch) return { duplicate: true, conflict: true, status: existing[0].status }
        if (existing[0].status === 'applied' && existing[0].result != null) {
          return { duplicate: true, status: existing[0].status, result: existing[0].result }
        }
        // Existing rows from an older deployment may have been left in an incomplete state.
        // Do not falsely report success; require safe recovery/reconciliation.
        return { duplicate: true, status: existing[0].status, incomplete: true }
      }

      let result: any = { accepted: true, operation: op }
      const v = await tx`select sintergia.touch_app_state(${id},${JSON.stringify(state)}::jsonb,${String(t.sub || '')}) as version`
      result = { ...result, id, version: Number(v[0].version) }
      await tx`update sintergia.sync_operations set result=${JSON.stringify(result)}::jsonb,status='applied',completed_at=now() where request_id=${rid}`
      return { duplicate: false, status: 'applied', result }
    })

    if (outcome.conflict) return json(req, 409, { ok: false, error: 'request_id_conflict' })
    if (outcome.incomplete) return json(req, 503, { ok: false, error: 'operation_incomplete', status: outcome.status })
    if (outcome.duplicate) return json(req, 200, { ok: true, idempotent: true, status: outcome.status, result: outcome.result })
    return json(req, 200, { ok: true, ...outcome.result })
  } catch {
    return json(req, 503, { ok: false, error: 'sync_unavailable' })
  }
})
