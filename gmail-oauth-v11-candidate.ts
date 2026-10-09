import postgres from 'npm:postgres@3.4.3'
const enc = new TextEncoder()
let db: any = null
function sql() {
  if (!db) {
    const url = Deno.env.get('SUPABASE_DB_URL')
    if (!url) throw new Error('missing_db_url')
    db = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
  }
  return db
}
function b64u(bytes: Uint8Array) {
  let result = ''; for (const value of bytes) result += String.fromCharCode(value)
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function b64d(value: string) {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
async function hmacKey() {
  const rows = await sql()`select value from sintergia.server_secrets where name='session_hmac'`
  if (!rows.length) throw new Error('missing_session_secret')
  return crypto.subtle.importKey('raw', enc.encode(String(rows[0].value)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
async function signedState(payload: string) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(payload))
  return payload + '.' + b64u(new Uint8Array(signature))
}
async function verifyState(state: string) {
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), b64d(parts[1]), enc.encode(parts[0]))
    if (!valid) return false
    const raw = parts[0].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(raw + '='.repeat((4 - raw.length % 4) % 4)))
    return Number(payload?.exp) > Date.now() ? payload : false
  } catch { return false }
}
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function html(title: string, body: string, status = 200) {
  const safeTitle = escapeHtml(title), safeBody = escapeHtml(body)
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:system-ui;padding:32px;max-width:720px;margin:auto}</style></head><body><h2>${safeTitle}</h2><p>${safeBody}</p></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    },
  })
}
async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 12_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  return { response, data: await response.json().catch(() => ({})) }
}
Deno.serve(async req => {
  try {
    const url = new URL(req.url)
    if (req.method !== 'GET') return html('SintergiaSE', 'Método no permitido.', 405)
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || ''
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
    if (!clientId || !clientSecret) return html('Gmail no configurado', 'Faltan las credenciales OAuth del servidor.', 503)
    const base = (Deno.env.get('SUPABASE_URL') || url.origin).replace(/\/$/, '')
    const redirectUri = base + '/functions/v1/gmail-oauth'

    if (url.searchParams.get('start') === '1') {
      const payload = btoa(JSON.stringify({ iat: Date.now(), exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomUUID() }))
      const state = await signedState(payload)
      await sql()`insert into sintergia.server_secrets(name,value) values('gmail_oauth_state',${state}) on conflict(name) do update set value=excluded.value`
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent', state })
      return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 302)
    }
    const oauthError = url.searchParams.get('error')
    if (oauthError) return html('Autorización cancelada', 'Google devolvió: ' + oauthError, 400)
    const code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || ''
    if (!code || !state || code.length > 4096 || state.length > 4096) return html('SintergiaSE Gmail', 'La solicitud de autorización no es válida.', 400)
    const verified = await verifyState(state)
    if (!verified) return html('Autorización no válida', 'El estado OAuth no es válido o ha caducado.', 400)
    const rows = await sql()`select value from sintergia.server_secrets where name='gmail_oauth_state'`
    if (!rows.length || String(rows[0].value) !== state) return html('Autorización no válida', 'La autorización ya fue utilizada o no coincide.', 400)
    // Consume the one-time state before exchanging the authorization code.
    await sql()`delete from sintergia.server_secrets where name='gmail_oauth_state'`
    const exchange = await fetchJsonWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    })
    if (!exchange.response.ok || !exchange.data?.refresh_token) return html('No se pudo completar', 'Google no devolvió un token de actualización. Vuelve a iniciar la autorización.', 502)
    await sql()`insert into sintergia.server_secrets(name,value) values('google_refresh_token',${String(exchange.data.refresh_token)}) on conflict(name) do update set value=excluded.value`
    return html('Gmail conectado', 'SintergiaSE ya tiene autorización para enviar correo mediante Gmail. Puedes cerrar esta ventana.', 200)
  } catch (error) {
    console.error('gmail_oauth_error', String(error))
    return html('Error', 'No se pudo completar la configuración de Gmail.', 500)
  }
})
