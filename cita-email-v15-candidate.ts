import postgres from 'npm:postgres@3.4.3'

const dbUrl = Deno.env.get('SUPABASE_DB_URL')
if (!dbUrl) throw new Error('missing_db_url')
const db = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_REQUEST_BYTES = 256_000
const MAX_TEXT_CHARS = 20_000
const MAX_SUBJECT_CHARS = 300

function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
function b64url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function auth(req: Request): Promise<boolean> {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return false
  const parts = header.slice(7).split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  try {
    const rows = await db`select value from sintergia.server_secrets where name='session_hmac'`
    if (!rows.length) return false
    const key = await crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', key, b64d(parts[2]), enc.encode(parts[1]))) return false
    const payload = JSON.parse(dec.decode(b64d(parts[1])))
    return Number(payload?.exp) > Date.now() / 1000
  } catch { return false }
}
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-sintergia-request-id',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  }
  if (origin && allowed.includes(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true' }
  return headers
}
async function secret(name: string): Promise<string> { const rows = await db`select value from sintergia.server_secrets where name=${name}`; return rows.length ? String(rows[0].value) : '' }
function output(req: Request, status: number, body: unknown): Response {
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
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r\n?|\n/g, '<br>')
}
function sanitizeSubject(value: unknown): string {
  return String(value ?? 'Propuesta de cita — SintergiaSE').replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').trim().slice(0, MAX_SUBJECT_CHARS)
}
function validEmail(value: string): boolean {
  return value.length <= 254 && !/[;,]/.test(value) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
}
async function providerJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; data: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  return { response, data: await response.json().catch(() => ({})) }
}
async function gmail(to: string, subject: string, html: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
  const refresh = Deno.env.get('GMAIL_REFRESH_TOKEN') || await secret('google_refresh_token')
  if (!clientId || !clientSecret || !refresh) return { ok: false, error: 'gmail_not_authorized' }
  const token = await providerJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }, 10_000)
  if (!token.response.ok || !token.data?.access_token) return { ok: false, error: 'gmail_token_refresh_failed' }
  const from = Deno.env.get('EMAIL_FROM') || Deno.env.get('GMAIL_FROM') || ''
  const mime = ['To: ' + to, from ? 'From: ' + from : '', 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html].filter(Boolean).join('\r\n')
  const sent = await providerJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token.data.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  }, 15_000)
  if (!sent.response.ok) return { ok: false, error: 'gmail_send_failed' }
  return { ok: true, provider: 'gmail', provider_message_id: sent.data?.id || null }
}
async function resend(to: string, subject: string, html: string, requestId: string) {
  const key = Deno.env.get('RESEND_API_KEY') || '', from = Deno.env.get('EMAIL_FROM') || ''
  if (!key || !from) return { ok: false, error: 'resend_not_configured' }
  const sent = await providerJson('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify({ from, to: [to], subject, html }),
  }, 15_000)
  if (!sent.response.ok) return { ok: false, error: 'resend_send_failed' }
  return { ok: true, provider: 'resend', provider_message_id: sent.data?.id || null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return output(req, 405, { ok: false, error: 'method_not_allowed' })
  if (!await auth(req)) return output(req, 401, { ok: false, error: 'unauthorized' })
  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) { return output(req, error instanceof RangeError ? 413 : 400, { ok: false, error: error instanceof RangeError ? 'request_too_large' : 'invalid_json' }) }

  const to = String(body.to ?? '').trim()
  const texto = String(body.texto ?? '').trim()
  const avisoId = String(body.avisoId ?? body.aviso_id ?? '').trim().slice(0, 200)
  const cliente = String(body.cliente ?? '').trim().slice(0, 300)
  const subject = sanitizeSubject(body.asunto ?? body.subject)
  if (!validEmail(to) || !texto || !avisoId || texto.length > MAX_TEXT_CHARS || !subject) return output(req, 400, { ok: false, error: 'invalid_request' })

  let token = String(body.token ?? '').trim()
  let existing: any[] = []
  try {
    existing = token ? await db`select token,destination,payload from sintergia.cita_messages where token=${token} limit 1` : []
    if (existing.length && String(existing[0].destination) !== to) return output(req, 409, { ok: false, error: 'token_destination_mismatch' })
    if (!existing.length) token = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const base = (Deno.env.get('PUBLIC_FUNCTIONS_BASE_URL') || 'https://bgjicsowspppsjzigazb.supabase.co/functions/v1').replace(/\/$/, '')
    const yes = base + '/cita-respuesta?token=' + encodeURIComponent(token) + '&respuesta=si'
    const no = base + '/cita-respuesta?token=' + encodeURIComponent(token) + '&respuesta=no'
    const html = '<div style="font-family:Arial,sans-serif;line-height:1.5"><p>' + escapeHtmlText(texto) + '</p><p><a href="' + yes + '">Sí, confirmo</a> &nbsp; <a href="' + no + '">No, necesito otra propuesta</a></p></div>'
    const requestIdValue = String(req.headers.get('x-sintergia-request-id') || crypto.randomUUID())
    const requestId = requestIdValue.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 200) || crypto.randomUUID()
    const provider = (Deno.env.get('EMAIL_PROVIDER') || 'gmail').toLowerCase()
    if (!['gmail', 'resend', 'auto'].includes(provider)) return output(req, 503, { ok: false, error: 'email_provider_invalid', token })
    let result: any = provider === 'resend' ? await resend(to, subject, html, requestId) : await gmail(to, subject, html)
    if (!result.ok && provider === 'auto') result = await resend(to, subject, html, requestId)
    if (!result.ok) return output(req, 503, { ok: false, error: result.error || 'email_provider_unavailable', token })
    const payload = { avisoId, cliente, subject, provider: result.provider, provider_message_id: result.provider_message_id, request_id: requestId, created_at: new Date().toISOString() }
    if (existing.length) {
      await db`update sintergia.cita_messages set aviso_id=${avisoId},destination=${to},payload=${JSON.stringify(payload)}::jsonb,updated_at=now() where token=${token}`
    } else {
      await db`insert into sintergia.cita_messages(token,aviso_id,channel,destination,payload) values(${token},${avisoId},'email',${to},${JSON.stringify(payload)}::jsonb)`
    }
    return output(req, 200, { ok: true, messageId: result.provider_message_id || null, token, provider: result.provider })
  } catch (error) {
    // Do not disclose provider messages or secrets in client-facing errors.
    console.error('cita_email_error', String(error))
    return output(req, 503, { ok: false, error: 'service_unavailable', token: token || null })
  }
})
