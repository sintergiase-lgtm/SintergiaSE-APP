# SintergiaSE — paquete de reparaciones candidatas

**Fecha:** 9 de octubre de 2026. **Estado:** candidatos revisados estáticamente; no desplegados.

## Archivos incluidos

1. `sync-operations-v13-candidate.ts`: transacción e idempotencia de snapshots, casts explícitos a JSONB y rechazo `405` para operaciones `upsert/delete` que el endpoint actual no aplica; fuerza el fallback de snapshot del cliente en vez de confirmar cambios que no se guardaron.
2. `verify-receipt-v14-candidate.ts`: verificación de recibos en modo *fail closed*; exige referencia/importe concordantes con la factura registrada, conserva el archivo en Storage con hash y referencia JSONB (sin Base64 embebido), deriva el estado del resultado y deja PDF/HEIC pendientes de revisión manual.
3. `receipt-register-v13-candidate.ts`: impide reasignar un token a otra factura/importe; el reintento idéntico es idempotente.
4. `upload-receipt-v12-candidate.ts`: limita el cuerpo antes del parseo, valida Base64 y elimina el archivo de Storage si falla el registro en BD.
5. `upload-doc-v12-candidate.ts`: límites de petición y limpieza compensatoria de Storage si falla la inserción de metadatos.
6. `invoice-return-v12-candidate.ts`: limita cuerpo y adjuntos y hace atómicas las escrituras de devolución.
7. `cita-respuesta-v11-candidate.ts`: GET presenta una pantalla de confirmación; sólo POST explícito registra la respuesta.
8. `authenticate-v15-candidate/index.ts` + `authenticate-v15-candidate/session.ts`: CORS de lista explícita y límite de cuerpo para el login por contraseña. No es una función biométrica.
9. `ai-gateway-v14-candidate.ts`: límites de cuerpo/prompt/documento/schema, lista permitida de modelos, timeout y CORS de lista explícita.
10. `send-email-v14-candidate.ts`: limita cuerpo y HTML, limpia controles CR/LF del asunto, restringe destinatario a una dirección, limita tiempo de proveedores y aplica CORS estricto.
11. `cita-email-v15-candidate.ts`: limita cuerpo y texto, escapa el contenido como texto plano antes de insertarlo en HTML, sanea el asunto y aplica timeout/CORS estricto.
12. `cita-recordatorio-v14-candidate.ts`: limita el cuerpo y longitud del mensaje, valida el destinatario y escapa el mensaje de correo.
13. `cita-anulacion-reprogramacion-v13-candidate.ts`: limita y valida entrada, escapa el texto que se incluye en correo y aplica timeout/CORS estricto.
14. `cita-whatsapp-v14-candidate.ts`: límite de cuerpo y mensaje, validación E.164, timeout de Twilio y CORS estricto.
15. `gmail-oauth-v11-candidate.ts`: escapa los textos de respuesta HTML (incluido el error devuelto por OAuth), añade CSP/referrer/nosniff y timeout de la llamada de token.

## HTML: endurecimiento local adicional del cliente

- `index.html` y `SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html`: copias completas con el GET autenticado del snapshot, filtros de origen/ruta, limpieza segura de `flush()`, retención de operaciones/snapshots hasta su acuse y conservación de elementos añadidos concurrentemente. La página secundaria queda alineada con las reglas de cola y fallback de la principal.
- Ambas páginas también contienen fallback ante excepciones del proveedor GPS, validación de coordenadas, preflight biométrico protegido y manejo seguro de callbacks asíncronos; el control horario actualiza sólo las duraciones cada segundo y ya no reconstruye la tabla en cada tick. No se cambia el flujo normal ni el diseño.

## Pruebas ejecutadas

- TypeScript estático `tsc --noEmit` para los quince candidatos de función y archivos asociados: sin errores.
- `node test-candidate-invariants.cjs`: 13 grupos de invariantes aprobados.
- `node test-sync-operations-rules.cjs`: 7 invariantes de sincronización aprobados.
- `node test-receipt-verification-rules.cjs`: 34 aserciones de reglas, límites y persistencia de recibos extraídas del propio candidato aprobadas; ya no dependen de `stripTypeScriptTypes` experimental.
- `node test-email-security-rules.cjs`: 10 pruebas unitarias extraídas de los candidatos de correo, IA y OAuth aprobadas.
- `node test-appointment-html-rules.cjs`: 7 pruebas de escape HTML para mensajes de citas aprobadas.
- Las dos páginas HTML del paquete: sus 45 scripts inline cada una pasan `node --check`; el paquete incluye las correcciones de backend, metadatos PWA, carácter de control, delegado de eventos duplicado y estabilidad de sincronización/GPS descritas en el informe de revisión entregado junto con el ZIP.
- `test-gps-runtime-errors.cjs`, `test-biometric-error-containment.cjs`, `test-sync-flush-failures.cjs`, `test-sync-queue-retention.cjs` y `test-ui-live-duration-performance.cjs` fuerzan fallos GPS/biométricos, desconexiones/acuse de colas, altas concurrentes, filtros de endpoints y actualización incremental en ambas páginas.
- Integridad del ZIP: `unzip -t` sin errores.

## Bloqueadores antes de desplegar

- Configurar y verificar `ALLOWED_ORIGINS` con los orígenes exactos autorizados de GitHub Pages, dominio propio y AppsGeyser. Si queda vacío, los navegadores legítimos no recibirán cabeceras CORS.
- No se ha ejecutado Deno en runtime ni pruebas integradas contra una instancia aislada de Supabase/Storage/proveedores. La compilación de TypeScript no demuestra que funciones, permisos ni esquemas estén bien en ejecución.
- `ai-gateway`: falta una cuota de coste/uso por sesión validada con el esquema real; además, `OPENAI_MODEL` y `OPENAI_ALLOWED_MODELS` deben ser coherentes con un modelo admitido por la cuenta.
- `send-email`: Gmail no garantiza idempotencia por la cabecera del cliente. Si Gmail envía el correo y falla la escritura posterior en BD, un reintento podría volver a enviarlo. Se requiere un diseño con clave idempotente persistida antes del envío y estados de recuperación, sin asumir que una transacción local puede revertir un envío externo.
- Probar en entorno aislado errores `200/409/401/403/5xx`, conflictos simultáneos, rollback, caducidad de sesión, límites de cuerpo y fallos de Storage/proveedor.
- Inspeccionar el HTML de producción por secciones y probar en navegador; el conector no permitió descargar completos algunos HTML de varios megabytes.
- Resolver el aviso de RLS sin políticas tras confirmar el modelo de acceso y revisar los `verify_jwt=false` junto con autenticación personalizada, scopes y permisos funcionales.

## Producción y biometría

No se desplegó ningún candidato, no se aplicaron migraciones ni se cambiaron datos, secretos o políticas. Las funciones activas `register-biometric` v19 y `authenticate-biometric` v18 no se modificaron. Los candidatos están preparados para revisión/pruebas, no para asumir que la aplicación está libre de errores.

## Hallazgo adicional en el backend activo
La lectura de solo lectura encontró que las 69 filas actuales de `sync_operations` tienen `operation=snapshot`, `payload` y `result` almacenados como escalares JSONB de tipo string; sus resultados son cadenas que contienen `{"accepted":true,"operation":"snapshot"}`. La tabla `app_state` está vacía. El código activo de `sync-operations` v12 también confirma `upsert/delete` con HTTP 200 sin aplicar esos cambios a `app_state`. El candidato evita el falso acuse: devuelve 405 para esas operaciones, que el HTML ya trata como endpoint opcional y convierte en fallback a snapshot; y escribe payload/result JSONB como objetos. No se ha desplegado.

## Prueba de regresión del fallback de snapshot

- `test-snapshot-auth-regression.cjs` extrae `postSnapshot()` del HTML v4 y lo ejecuta con `fetch` simulado. Comprueba que se envían el Bearer de sesión, `X-Sintergia-Request-ID`, el canal y el identificador de cambio, y que no se envían cookies.
- Ejecutar: `node test-snapshot-auth-regression.cjs /ruta/al/SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html`.
- Es una prueba aislada del cliente; no verifica que el token sea aceptado por Supabase ni que la escritura real en `app_state` funcione.

