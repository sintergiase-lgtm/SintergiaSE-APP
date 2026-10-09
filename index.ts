import { getSql, json, preflight, issueToken, clientIp, sha256Hex } from './session.ts'
const SESSION_TTL_SECONDS = 8 * 60 * 60
const MAX_REQUEST_BYTES = 8_000
async function readJsonLimited(req: Request): Promise<any> {
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
  const parsed = JSON.parse(new TextDecoder().decode(bytes))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json')
  return parsed
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method === 'GET') {
    try {
      const sql = getSql()
      const rows = await sql`select exists(select 1 from sintergia.server_secrets where name='session_hmac') as secret, exists(select 1 from sintergia.credentials) as credentials`
      const configured = Boolean(rows[0]?.secret) && Boolean(rows[0]?.credentials)
      return json(req, 200, { ok: true, service: 'authenticate', configured })
    } catch (error) {
      console.error('authenticate_health', String((error as Error)?.message ?? error))
      return json(req, 503, { ok: false, error: 'service_unavailable' })
    }
  }
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'Método no permitido' })
  let body: any
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? json(req, 413, { ok: false, error: 'Petición demasiado grande' })
      : json(req, 400, { ok: false, error: 'Petición no válida' })
  }
  const scope = body?.scope
  const password = typeof body?.password === 'string' ? body.password : ''
  if ((scope !== 'modo' && scope !== 'operacion') || password.length > 200) return json(req, 400, { ok: false, error: 'Petición no válida' })
  if (password.length === 0) return json(req, 401, { ok: false, error: 'Contraseña incorrecta' })
  try {
    const sql = getSql()
    const key = await sha256Hex(clientIp(req) + '|' + scope)
    const rows = await sql`select sintergia.auth_check(${key},${scope},${password}) as r`
    const result = rows[0]?.r ?? { status: 'invalid' }
    if (result.status === 'ok') {
      const issued = await issueToken({ sub: result.id, scope, tenant: 'sintergia' }, SESSION_TTL_SECONDS)
      return json(req, 200, { ok: true, token: issued.token, scope, id: result.id, expiresAt: issued.expiresAt })
    }
    if (result.status === 'blocked') {
      const wait = Number(result.retry_after) || 900
      return json(req, 429, { ok: false, error: 'Demasiados intentos. Inténtalo de nuevo en ' + Math.ceil(wait / 60) + ' min.', retryAfter: wait }, { 'Retry-After': String(wait) })
    }
    if (result.status === 'unconfigured') return json(req, 503, { ok: false, error: 'Las contraseñas aún no están configuradas en el servidor.' })
    return json(req, 401, { ok: false, error: 'Contraseña incorrecta' })
  } catch (error) {
    console.error('authenticate_error', String((error as Error)?.message ?? error))
    return json(req, 503, { ok: false, error: 'Servicio de acceso no disponible' })
  }
})
