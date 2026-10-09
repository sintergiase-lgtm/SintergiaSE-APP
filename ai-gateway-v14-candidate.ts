import postgres from 'npm:postgres@3.4.3'

const dbUrl = Deno.env.get('SUPABASE_DB_URL')
if (!dbUrl) throw new Error('missing_db_url')
const db = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })
const enc = new TextEncoder(), dec = new TextDecoder()
const MAX_REQUEST_BYTES = 22_000_000
const MAX_PROMPT_CHARS = 30_000
const MAX_DOCUMENT_BASE64_CHARS = 20_000_000
const MAX_SCHEMA_CHARS = 20_000
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const KEY_NAMES = ['OPENAI_API_KEY', 'OPENAI_KEY', 'OPENAI_TOKEN', 'OPENAI_API_TOKEN', 'OPENAI_SECRET_KEY', 'OPENAI_ACCESS_TOKEN', 'AI_API_KEY']

function b64d(value: string): Uint8Array {
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
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
async function configuredKey(): Promise<{ key: string; source: string } | null> {
  for (const name of KEY_NAMES) {
    const value = Deno.env.get(name)
    if (value?.trim()) return { key: value.trim(), source: `env:${name}` }
  }
  try {
    const rows = await db`
      select name,value from sintergia.server_secrets
      where lower(name) in ('openai_api_key','openai_key','openai_token','openai_api_token','openai_secret_key','openai_access_token','ai_api_key')
      order by name limit 1
    `
    if (rows.length && String(rows[0].value || '').trim()) return { key: String(rows[0].value).trim(), source: `db:${String(rows[0].name)}` }
  } catch { /* no provider secret is returned to clients */ }
  return null
}
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-requested-with,x-sintergia-request-id,apikey,x-client-info',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  }
  if (origin && allowed.includes(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true' }
  return headers
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } })
}
function preflight(req: Request): Response { return new Response(null, { status: 204, headers: cors(req) }) }
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json_object')
  return parsed as Record<string, unknown>
}
function safeName(value: unknown): string { return String(value || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document' }
function safeSchemaName(value: unknown): string { return String(value || 'sintergia_response').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'sintergia_response' }
function outputText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text
  let result = ''
  for (const item of (Array.isArray(data?.output) ? data.output : [])) {
    for (const part of (item?.content || [])) if (typeof part?.text === 'string') result += part.text
  }
  return result
}
function buildInput(prompt: string, body: Record<string, unknown>): unknown {
  const document = body.document as Record<string, unknown> | undefined
  if (!document) return prompt
  const raw = String(document.dataBase64 || '').trim()
  if (!raw) throw new Error('document_data_required')
  if (raw.length > MAX_DOCUMENT_BASE64_CHARS) throw new Error('document_too_large')
  if (!/^[A-Za-z0-9+/=_-]+$/.test(raw) || raw.length % 4 === 1) throw new Error('invalid_document_encoding')
  const type = String(document.type || '').toLowerCase().split(';')[0].trim()
  const name = safeName(document.name)
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    return [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_file', filename: name, file_data: 'data:application/pdf;base64,' + raw }] }]
  }
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new Error('unsupported_document_type')
  return [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', detail: 'high', image_url: `data:${type};base64,${raw}` }] }]
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' })
  if (!await session(req)) return json(req, 401, { ok: false, error: 'unauthorized' })
  let body: Record<string, unknown>
  try { body = await readJsonLimited(req) }
  catch (error) {
    return error instanceof RangeError
      ? json(req, 413, { ok: false, error: 'request_too_large' })
      : json(req, 400, { ok: false, error: 'invalid_json' })
  }
  const prompt = String(body.input ?? body.prompt ?? '').trim()
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return json(req, 400, { ok: false, error: 'invalid_input' })

  const defaultModel = Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna'
  const permittedModels = (Deno.env.get('OPENAI_ALLOWED_MODELS') || defaultModel).split(',').map(value => value.trim()).filter(Boolean)
  const requestedModel = String(body.model || 'auto')
  const model = requestedModel === 'auto' ? defaultModel : requestedModel
  if (!permittedModels.includes(model)) return json(req, 400, { ok: false, error: 'model_not_allowed' })

  const responseFormat = body.responseFormat
  let format = 'text'
  const payload: Record<string, unknown> = { model, input: null, store: false }
  if (typeof responseFormat === 'string') {
    format = responseFormat.toLowerCase()
    if (format === 'json' || format === 'json_object') payload.text = { format: { type: 'json_object' } }
    else if (format !== 'text' && format) return json(req, 400, { ok: false, error: 'invalid_response_format' })
  } else if (responseFormat && typeof responseFormat === 'object') {
    const requested = responseFormat as Record<string, unknown>
    const schema = requested.schema
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return json(req, 400, { ok: false, error: 'invalid_response_schema' })
    const schemaJson = JSON.stringify(schema)
    if (schemaJson.length > MAX_SCHEMA_CHARS) return json(req, 413, { ok: false, error: 'response_schema_too_large' })
    format = 'json_schema'
    payload.text = { format: { type: 'json_schema', name: safeSchemaName(requested.name), schema, strict: true } }
  }
  try { payload.input = buildInput(prompt, body) }
  catch (error) {
    const message = String((error as Error)?.message || error)
    if (message === 'document_too_large') return json(req, 413, { ok: false, error: message })
    if (message === 'document_data_required' || message === 'invalid_document_encoding' || message === 'unsupported_document_type') return json(req, 400, { ok: false, error: message })
    return json(req, 400, { ok: false, error: 'invalid_input' })
  }
  const configured = await configuredKey()
  if (!configured) return json(req, 503, { ok: false, error: 'ai_not_configured' })
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${configured.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data: any = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('ai_gateway_provider_error', response.status)
      return json(req, 502, { ok: false, error: 'provider_error', status: response.status })
    }
    const result = outputText(data)
    if (!result) return json(req, 502, { ok: false, error: 'empty_provider_response' })
    return json(req, 200, { ok: true, result, model, responseId: data?.id || null, format })
  } catch (error) {
    console.error('ai_gateway_error', String(error))
    return json(req, 503, { ok: false, error: 'ai_unavailable' })
  }
})
