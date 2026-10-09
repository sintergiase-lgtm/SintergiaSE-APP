import postgres from 'npm:postgres@3.4.3'

const databaseUrl = Deno.env.get('SUPABASE_DB_URL')
if (!databaseUrl) throw new Error('missing_db_url')
const db = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 })

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
}
function page(status: number, title: string, message: string, form?: { token: string; answer: string }): Response {
  const formHtml = form
    ? `<form method="post" action=""><input type="hidden" name="token" value="${escapeHtml(form.token)}"><input type="hidden" name="respuesta" value="${escapeHtml(form.answer)}"><button type="submit">Confirmar ${form.answer === 'si' ? 'asistencia' : 'rechazo'}</button></form>`
    : ''
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="referrer" content="no-referrer"><style>body{font-family:system-ui,sans-serif;max-width:620px;margin:12vh auto;padding:24px;text-align:center;color:#202124}h1{font-size:26px}p{font-size:18px}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;background:#175cd3;color:white;cursor:pointer}</style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${formHtml}</main></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } })
}
function isAnswer(value: string): boolean { return value === 'si' || value === 'no' }

Deno.serve(async req => {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const token = String(url.searchParams.get('token') || '').trim()
    const answer = String(url.searchParams.get('respuesta') || '').toLowerCase().trim()
    if (!token || token.length > 200 || !isAnswer(answer)) return page(400, 'Enlace no válido', 'La respuesta no es válida.')
    try {
      const rows = await db`select response from sintergia.cita_messages where token=${token} limit 1`
      if (!rows.length) return page(404, 'Cita no encontrada', 'Este enlace ya no es válido.')
      if (rows[0].response) return page(200, 'Respuesta ya registrada', 'Esta cita ya tiene una respuesta registrada.')
      // A GET only renders a confirmation step; it never changes appointment state.
      return page(200, 'Confirmar respuesta de cita', answer === 'si'
        ? 'Pulsa el botón para confirmar tu asistencia.'
        : 'Pulsa el botón para confirmar que no asistirás.', { token, answer })
    } catch (error) {
      console.error('cita_respuesta_read_error', String(error))
      return page(503, 'Servicio no disponible', 'No se pudo comprobar la cita. Inténtalo más tarde.')
    }
  }

  if (req.method === 'POST') {
    let form: URLSearchParams
    try {
      const declared = Number(req.headers.get('content-length') || 0)
      if (declared > 8_000) return page(413, 'Solicitud demasiado grande', 'Vuelve a abrir el enlace de la cita.')
      const raw = await req.text()
      if (new TextEncoder().encode(raw).byteLength > 8_000) return page(413, 'Solicitud demasiado grande', 'Vuelve a abrir el enlace de la cita.')
      form = new URLSearchParams(raw)
    } catch { return page(400, 'Solicitud no válida', 'No se pudo leer la respuesta.') }
    const token = String(form.get('token') || '').trim()
    const answer = String(form.get('respuesta') || '').toLowerCase().trim()
    if (!token || token.length > 200 || !isAnswer(answer)) return page(400, 'Enlace no válido', 'La respuesta no es válida.')
    try {
      const rows = await db`
        update sintergia.cita_messages
        set response=${answer}, response_at=now(), updated_at=now()
        where token=${token} and response is null
        returning token
      `
      if (rows.length) return page(200, answer === 'si' ? 'Cita confirmada' : 'Respuesta registrada', answer === 'si'
        ? 'Gracias. Tu asistencia ha quedado confirmada.'
        : 'Gracias. Hemos registrado que no asistirás.')
      const existing = await db`select response from sintergia.cita_messages where token=${token} limit 1`
      if (!existing.length) return page(404, 'Cita no encontrada', 'Este enlace ya no es válido.')
      return page(200, 'Respuesta ya registrada', 'Esta cita ya tenía una respuesta registrada.')
    } catch (error) {
      console.error('cita_respuesta_write_error', String(error))
      return page(503, 'Servicio no disponible', 'No se pudo registrar la respuesta. Inténtalo más tarde.')
    }
  }
  return page(405, 'Método no permitido', 'Abre el enlace de respuesta de la cita.')
})
