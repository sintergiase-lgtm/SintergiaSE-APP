import postgres from 'npm:postgres@3.4.3'

const databaseUrl = Deno.env.get('SUPABASE_DB_URL')
if (!databaseUrl) throw new Error('missing_db_url')
const db = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_REQUEST_BYTES = 256_000
const MAX_HTML_CHARS = 200_000

function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
function b64url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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
async function secret(name: string): Promise<string> {
  const rows = await db`select value from sintergia.server_secrets where name=${name}`
  return rows.length ? String(rows[0].value) : ''
}
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  }
  if (origin && allowed.includes(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true' }
  return headers
}
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
function validEmail(value: string): boolean { return value.length <= 254 && !/[;,]/.test(value) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) }
function sanitizeSubject(value: unknown): string { return String(value ?? '').replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 300) }
async function providerJson(url: string, init: RequestInit, timeoutMs = 15_000): Promise<{ response: Response; data: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}
async function gmail(to: string, subject: string, html: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
  const refresh = Deno.env.get('GMAIL_REFRESH_TOKEN') || await secret('google_refresh_token')
  if (!clientId || !clientSecret || !refresh) return { ok: false, error: 'gmail_not_authorized' }
  const tokenResult = await providerJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }, 10_000)
  if (!tokenResult.response.ok || !tokenResult.data?.access_token) return { ok: false, error: 'gmail_token_refresh_failed' }
  const from = Deno.env.get('EMAIL_FROM') || Deno.env.get('GMAIL_FROM') || ''
  const mime = ['To: ' + to, from ? 'From: ' + from : '', 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html].filter(Boolean).join('\r\n')
  const sent = await providerJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tokenResult.data.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  })
  if (!sent.response.ok) return { ok: false, error: 'gmail_send_failed' }
  return { ok: true, provider: 'gmail', provider_message_id: sent.data?.id || null }
}
async function resend(to: string, subject: string, html: string, requestId: string) {
  const key = Deno.env.get('RESEND_API_KEY') || ''
  const from = Deno.env.get('EMAIL_FROM') || ''
  if (!key || !from) return { ok: false, error: 'resend_not_configured' }
  const sent = await providerJson('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!sent.response.ok) return { ok: false, error: 'resend_send_failed' }
  return { ok: true, provider: 'resend', provider_message_id: sent.data?.id || null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return output(req, 405, { ok: false, error: 'method_not_allowed' })
  if (!await session(req)) return output(req, 401, { ok: false, error: 'unauthorized' })
  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? output(req, 413, { ok: false, error: 'request_too_large' })
      : output(req, 400, { ok: false, error: 'invalid_json' })
  }
  const to = String(body.to ?? body.email ?? '').trim()
  // Strip control characters before embedding the subject into a MIME header.
  const subject = sanitizeSubject(body.subject)
  const html = String(body.body ?? body.html ?? '')
  if (!validEmail(to) || !subject || !html) return output(req, 400, { ok: false, error: 'invalid_email' })
  if (html.length > MAX_HTML_CHARS) return output(req, 413, { ok: false, error: 'email_body_too_large' })
  const requestIdRaw = String(req.headers.get('x-sintergia-request-id') || crypto.randomUUID())
  const requestId = requestIdRaw.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 200) || crypto.randomUUID()
  const provider = (Deno.env.get('EMAIL_PROVIDER') || 'gmail').toLowerCase()
  if (!['gmail', 'resend', 'auto'].includes(provider)) return output(req, 503, { ok: false, error: 'email_provider_invalid' })
  try {
    let result: any = provider === 'resend' ? await resend(to, subject, html, requestId) : await gmail(to, subject, html)
    if (!result.ok && provider === 'auto') result = await resend(to, subject, html, requestId)
    if (!result.ok) return output(req, 503, { ok: false, error: result.error || 'email_provider_unavailable' })
    const id = crypto.randomUUID()
    await db`
      insert into sintergia.email_messages(id,to_address,subject,provider,status,provider_message_id,sent_at)
      values(${id},${to},${subject},${result.provider},'sent',${result.provider_message_id || null},now())
    `
    return output(req, 200, { ok: true, messageId: id, provider: result.provider, providerMessageId: result.provider_message_id || null })
  } catch (error) {
    console.error('send_email_error', String(error))
    return output(req, 503, { ok: false, error: 'service_unavailable' })
  }
})
