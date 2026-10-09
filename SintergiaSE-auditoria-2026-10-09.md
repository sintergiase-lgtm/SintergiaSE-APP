# SintergiaSE — revisión técnica incremental
Fecha: 2026-10-09

## Alcance realizado
- Revisado el código activo de Supabase Edge Function `sync-operations` v12 y el candidato `sync-operations-v13-candidate.ts`.
- Consultado el esquema de tablas del esquema `sintergia` y los asesores de seguridad/rendimiento de Supabase.
- Ejecutado un chequeo estático TypeScript del candidato con declaraciones mínimas para Deno y `npm:postgres`.
- No se han desplegado funciones ni aplicado migraciones ni modificado datos de producción.
- No se han modificado las funciones biométricas.

## Verificaciones
- TypeScript: `tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --skipLibCheck` — sin errores.
- `sintergia.sync_operations`: 69 registros; 0 `pending`; 0 `failed`; 0 registros `applied` sin `result` o `completed_at`.
- `sintergia.webauthn_credentials`: 2 credenciales registradas.
- `sintergia.webauthn_challenges`: 23 retos expirados sin consumir y 0 retos sin consumir todavía vigentes en el momento de la consulta. No se borraron ni alteraron.

## Cambios del candidato v13 frente a v12
- Claim de `request_id`, cambio de estado y resultado dentro de una única transacción.
- Reintento idéntico devuelve el resultado guardado.
- Reutilizar un `request_id` con operación o payload distinto responde `409 request_id_conflict`.
- Un registro previo incompleto responde `503 operation_incomplete`, en vez de fingir éxito.

## Riesgos/pendientes
1. La versión activa en Supabase sigue siendo v12; el candidato no está desplegado.
2. No se pudo ejecutar una prueba de integración real con Deno y base de datos desde este entorno. La compilación estática no demuestra comportamiento en producción.
3. El candidato conserva la lógica CORS heredada: si `ALLOWED_ORIGINS` está vacío, refleja el origen entrante. Antes de endurecerlo hay que confirmar los orígenes reales y configurar la variable; cambiarlo a ciegas podría bloquear la app.
4. Supabase Security Advisor informa 14 tablas del esquema `sintergia` con RLS activado y sin políticas explícitas. Esto puede ser intencional si sólo acceden funciones servidor con credenciales privilegiadas; hay que revisar grants y exposición antes de añadir políticas.
5. Hay 23 retos WebAuthn caducados no consumidos. No se limpiaron para evitar tocar el flujo biométrico que el usuario indicó que funciona. Conviene revisar la caducidad/limpieza en una tarea separada.
6. El conector no ha permitido confirmar una escritura del candidato corregido en GitHub; la copia corregida sí se guardó en la Biblioteca de ChatGPT.

## Plan de pruebas antes del despliegue
- Sin token / token inválido / token caducado -> `401`.
- Método distinto de POST -> `405`; OPTIONS -> `204`.
- `request_id` vacío o de más de 200 caracteres -> `400`.
- Primera operación válida -> `200`, un solo registro, estado `applied`, resultado y `completed_at`.
- Mismo `request_id`, mismo cuerpo -> `200` idempotente y sin segunda mutación.
- Mismo `request_id`, operación o payload distinto -> `409`.
- Dos solicitudes simultáneas con el mismo ID -> una mutación como máximo.
- Fallo dentro de la transacción -> rollback completo; un reintento debe poder completarse.
- Origen permitido y no permitido -> comprobar cabeceras CORS con `ALLOWED_ORIGINS` configurado.

## Recomendación
Mantener v12 activa hasta ejecutar estas pruebas en un entorno de pruebas. No modificar `register-biometric` ni `authenticate-biometric` durante esta reparación.

## Comprobación adicional de permisos (9 de octubre de 2026)
- Consulta de `information_schema.role_table_grants` para las 14 tablas de `sintergia`: no devolvió concesiones directas a `anon`, `authenticated`, `service_role` ni `PUBLIC`; las concesiones visibles en la consulta de tablas eran sólo para `postgres`.
- Interpretación limitada: esto reduce indicios de acceso directo por esos roles mediante grants de tabla, pero no sustituye una auditoría completa de privilegios de esquema, funciones `SECURITY DEFINER`, vistas, Storage, ni de las rutas de Edge Functions. No se modificaron permisos.
- Las consultas de auditoría fueron de solo lectura.

## Siguiente bloque de trabajo recomendado
1. Confirmar CORS en el entorno real: revisar `ALLOWED_ORIGINS` y los dominios de GitHub Pages/AppsGeyser usados por la app antes de cambiarlo.
2. Crear una rama de pruebas o un entorno aislado para probar v13, sin desplegar sobre producción.
3. Auditar cada Edge Function activa por autorización y exposición de datos; no asumir que `verify_jwt=false` implica vulnerabilidad por sí solo, porque algunas funciones usan tokens propios.
4. Mantener las funciones biométricas intactas hasta tener pruebas específicas de registro/autenticación y expiración de challenges.

## Revisión incremental de Edge Functions activas
Se inspeccionó el código activo de `health` v13, `authenticate` v14 (incluido `session.ts`), `realtime-snapshot` v14, `ai-gateway` v13, `route` v12 y `allocate-reference` v10.

Hallazgos concretos:
- `authenticate/session.ts` define `ALLOW_ANY_ORIGIN=true`, por lo que refleja cualquier origen que envíe una petición. `health` usa `Access-Control-Allow-Origin: *`. CORS no sustituye la autenticación, pero conviene limitar los orígenes de la app en las funciones que admiten sesión.
- `realtime-snapshot`, `ai-gateway`, `route`, `allocate-reference` y `sync-operations` validan el token de sesión propio en el código inspeccionado. Esto es importante porque esas funciones están desplegadas con `verify_jwt=false`; no deben confundirse con endpoints públicos sin autenticación.
- `ai-gateway` requiere token, pero acepta un modelo proporcionado por el cliente y procesa prompts/documentos grandes. Conviene añadir límites de coste/uso por sesión, lista permitida de modelos y límites de tamaño consistentes antes de uso intensivo. No se cambió su comportamiento.
- La descarga completa de los HTML de varios megabytes a través del conector GitHub no se pudo completar por el límite del conector. Por ello no declaro auditado el frontend entero ni sus llamadas biométricas.

Acciones deliberadamente no realizadas:
- No cambié `ALLOW_ANY_ORIGIN`, CORS ni variables de entorno porque antes hay que confirmar todos los dominios de producción, AppsGeyser y GitHub Pages; hacerlo a ciegas podría bloquear el acceso.
- No desplegué Edge Functions ni cambié datos, secretos, credenciales biométricas o políticas.

Prioridad técnica propuesta:
1. Confirmar lista exacta de orígenes legítimos y preparar un parche CORS para revisión.
2. Crear entorno de pruebas y ejecutar la matriz de idempotencia v13.
3. Revisar el frontend por fragmentos pequeños (biometría, cliente de sincronización y configuración API) en lugar de descargar el HTML completo.
4. Establecer límites de consumo en `ai-gateway` y revisar todas las funciones activas que dependen de tokens propios.

## Segunda revisión incremental: recibos, documentos, citas y CORS
Fecha: 2026-10-09, continuación de la misma sesión.

### Hallazgos confirmados en código activo
- `verify-receipt` v13: el booleano final se calculaba con `parsed.referenciaCoincide !== false` y `parsed.importeCoincide !== false`. Por tanto, campos ausentes podían no impedir una aprobación, aunque después las banderas almacenadas figuraran como `false`. El candidato v14 exige ambos campos exactamente `true`, referencia no vacía e igual a la esperada, e importe leído dentro de una tolerancia de 0,01. El resultado de la IA no se trata como prueba suficiente si no coinciden también esos valores.
- `receipt-register` v12: el `ON CONFLICT(token) DO UPDATE` podía cambiar `factura_id`, `importe` y `cliente` de un token ya existente. El candidato v13 mantiene registros idénticos idempotentes y devuelve `409 token_conflict` si el token se vuelve a asociar a otros datos.
- `upload-receipt` v11: ejecuta `req.json()` antes de imponer un límite total al cuerpo y decodifica Base64 antes de comprobar el límite de bytes. Si la subida a Storage funciona y la inserción/actualización de base de datos falla, puede quedar un objeto huérfano. El candidato v12 limita el cuerpo antes de parsearlo, valida Base64/tamaño, agrupa los cambios de base de datos en una transacción y elimina el archivo subido si falla el registro.
- `upload-doc` v11: aunque limita la longitud de la cadena Base64 tras `req.json()`, el cuerpo JSON completo se procesa antes de ese límite. Si Storage acepta el archivo y el registro de metadatos falla, también puede quedar un objeto huérfano. El candidato v12 añade límite al cuerpo en streaming y limpieza compensatoria del archivo.
- `invoice-return` v11: la ruta pública basada en token ejecuta escrituras separadas en `invoice_returns` y `receipt_tokens`, sin transacción ni límite total del cuerpo. Se conserva el patrón de enlace con token (para no romper el flujo del cliente), pero el candidato v12 impone límite de solicitud/adjuntos y hace ambas escrituras atómicas.
- `cita-respuesta` v10: el método GET actual cambia el estado de la cita. Los escáneres automáticos de correo pueden visitar enlaces antes de que el usuario elija. El candidato v11 convierte GET en pantalla de confirmación y sólo actualiza la respuesta mediante POST tras pulsar el botón; la actualización condicional gestiona también solicitudes simultáneas.
- Hay varias funciones que devuelven CORS reflejando `Origin` sin lista estricta, o con una ruta de respaldo permisiva cuando `ALLOWED_ORIGINS` está vacío. El resto de candidatos usa lista explícita y falla de forma cerrada, pero no deben desplegarse hasta confirmar que `ALLOWED_ORIGINS` contiene todos los orígenes legítimos usados por GitHub Pages, dominio propio y contenedor AppsGeyser.

### Comprobaciones de esta iteración
- TypeScript estático para seis candidatos (`verify-receipt`, `invoice-return`, `receipt-register`, `upload-receipt`, `upload-doc`, `cita-respuesta`): sin errores con `tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --skipLibCheck` y declaraciones de tipos de entorno.
- Pruebas de reglas de verificación: 9/9 casos correctos en una matriz unitaria independiente (coincidencia exacta, banderas ausentes, referencia errónea, importe fuera de tolerancia, importe negativo, rechazo explícito, salida malformada y referencia vacía).
- Los logs agregados del último día no devolvieron campos `function_slug`/`status_code` con la consulta inicial; por ello esa consulta no permite concluir tasa de errores HTTP. Una segunda consulta de esquema de logs devolvió un error del backend. No se ha declarado limpio el runtime a partir de esos logs.
- Los candidatos son archivos locales de revisión: no se han desplegado, no se han ejecutado contra tablas reales y no se han cambiado registros, Storage, secretos o políticas.

### Archivos candidatos generados
- `verify-receipt-v14-candidate.ts`
- `receipt-register-v13-candidate.ts`
- `upload-receipt-v12-candidate.ts`
- `upload-doc-v12-candidate.ts`
- `invoice-return-v12-candidate.ts`
- `cita-respuesta-v11-candidate.ts`
- Se mantiene además `sync-operations-v13-candidate.ts` de la iteración anterior.

### Bloqueadores antes de considerar el proyecto sin errores
1. Pruebas de integración contra una instancia de pruebas, con tokens válidos/expirados, conflictos, dos solicitudes simultáneas, rollback y fallos de Storage.
2. Confirmar orígenes reales y probar preflight/POST desde navegador y desde el contenedor AppsGeyser. Las variables de entorno no se cambiaron.
3. Verificar que `receipt_tokens.importe` y el formato de referencia en datos reales son suficientes para verificar factura/recibo; el candidato falla de forma cerrada si no hay referencia o importe esperado.
4. Confirmar comportamiento UI al recibir `409` de registro y la pantalla intermedia de confirmación de cita.
5. Revisar el HTML de producción por secciones pequeñas. La inspección completa del HTML y pruebas reales de navegador siguen pendientes.
6. Mantener `register-biometric` v19 y `authenticate-biometric` v18 intactas; no se han tocado.

**Estado honesto:** seis candidatos pasan comprobaciones estáticas; 9 pruebas de reglas pasan. No es correcto afirmar que todo el sistema esté libre de errores hasta completar pruebas de integración y flujo de navegador en un entorno aislado.

## Tercera revisión: autenticación de contraseña y asesores actuales
- `authenticate` v14 usa `session.ts`, donde `ALLOW_ANY_ORIGIN=true` habilita el reflejo del origen recibido. El candidato `authenticate-v15-candidate/` cambia esto por allowlist estricta mediante `ALLOWED_ORIGINS` y añade límite de cuerpo de 8 KB antes del parseo de JSON. Conserva la validación de contraseña, el bloqueo de intentos, el TTL de sesión de 8 horas y el formato de token actuales. No se despliega porque la lista exacta de dominios legítimos todavía debe confirmarse.
- Security Advisor se consultó de nuevo: sigue mostrando 14 tablas con RLS activo y sin políticas (`rls_enabled_no_policy`, nivel INFO). No se añadieron políticas a ciegas; el acceso directo a tablas no puede arreglarse sin analizar funciones, roles y modelo de acceso servidor.
- Performance Advisor muestra seis índices sin uso observado (`unused_index`, nivel INFO). No se eliminaron; que el contador esté en cero no demuestra por sí mismo que sean innecesarios.
- La consulta de registros agregados identifica fuentes `edge_logs`, `function_edge_logs`, `function_logs`, `pgbouncer_logs`, `postgres_logs`, `postgrest_logs`, `realtime_logs` y `storage_logs`; sin embargo, las consultas que debían devolver filas de detalle devolvieron un error del backend. No es posible cerrar el análisis de errores HTTP con esos datos.
- Comprobación TypeScript estática actualizada para candidatos anteriores más `authenticate-v15-candidate/index.ts` y `session.ts`: sin errores.

## Paquete actualizado
El paquete ZIP se reconstruyó incrementalmente y contiene los candidatos de función, pruebas y este informe. La última compilación estática se ejecutó sobre las quince funciones candidatas y los archivos asociados; se validó la integridad del ZIP al reconstruirlo.

## Cuarta revisión: pasarela de IA
- `ai-gateway` v13: el código activo permite que el cliente seleccione cualquier `model` distinto de `auto`, acepta documentos de hasta 20 millones de caracteres y parsea `req.json()` sin límite total de cuerpo. La llamada externa no tiene timeout explícito y el CORS acepta el origen solicitado cuando `ALLOWED_ORIGINS` está vacío.
- Se añadió `ai-gateway-v14-candidate.ts`: limita el cuerpo completo (22 MB), impone límite al prompt y al esquema JSON, restringe modelo a `OPENAI_ALLOWED_MODELS` (por defecto sólo el modelo configurado por `OPENAI_MODEL` o `gpt-6-luna`), restringe documentos a PDF/formatos raster aceptados, fija timeout de 45 segundos y usa CORS de lista explícita. Para desplegarla, las variables `OPENAI_MODEL` y `OPENAI_ALLOWED_MODELS` deben ser coherentes.
- Sigue pendiente aplicar cuota/límite de coste por sesión: no lo he conectado a `app_events` ni a otra tabla sin probar primero el patrón transaccional y acordar cuánto uso debe permitirse. Tampoco se desplegó el candidato.

## Quinta revisión incremental: envío de correo y última batería estática

- `send-email` v13 del entorno activo analiza el cuerpo JSON sin límite total y coloca el asunto en cabeceras MIME sin neutralizar expresamente caracteres de control CR/LF. También acepta, con su validación original, valores que pueden representar múltiples destinatarios en un solo campo.
- Se preparó `send-email-v14-candidate.ts`: límite de cuerpo en streaming (256 KB), límite HTML (200.000 caracteres), limpieza CR/LF/control en asunto, rechazo de coma/punto y coma en el destinatario, timeout explícito para llamadas Gmail/Resend y CORS por lista de orígenes exactos. Mantiene el formato de registro `sintergia.email_messages` observado en la función activa.
- Riesgo sin resolver: en el flujo Gmail, el envío externo ocurre antes del insert del mensaje en la base de datos. Si Gmail acepta el mensaje y la inserción DB falla, un reintento puede duplicar el correo. El endpoint Resend usa `Idempotency-Key`, pero no puede usarse como garantía universal para Gmail. Hace falta una clave idempotente persistida antes del envío y una estrategia de reconciliación probada antes de rediseñar ese flujo.
- En `ai-gateway-v14-candidate.ts` se endureció el nombre de esquema JSON a `[A-Za-z0-9_-]`, longitud máxima de 64 caracteres. Sigue faltando una cuota de uso/coste por sesión; no se inventó una tabla/función de cuotas sin validación del esquema real.
- `test-candidate-invariants.cjs`: 8 grupos de invariantes aprobados. `test-receipt-verification-rules.cjs`: 9/9. `test-email-security-rules.cjs`: 8/8 (sanitización del asunto, longitud y dirección única, nombre JSON Schema). `tsc --noEmit` se ejecutó de nuevo sobre diez funciones candidatas y sus archivos asociados sin errores.
- Estos resultados son pruebas estáticas/unitarias; no sustituyen el runtime Deno, Supabase de pruebas, proveedores de correo, Storage ni navegador.

## Resultado acumulado y límites

El paquete tiene 10 candidatos de función. No se hizo ningún despliegue ni migración, no se alteraron secretos/policies/datos y no se tocaron `register-biometric` v19 ni `authenticate-biometric` v18. No es honesto declarar el sistema de producción “sin errores” todavía: faltan orígenes autorizados confirmados, entorno de integración aislado, pruebas reales del navegador y proveedor, cuotas de IA, y garantía idempotente de correo Gmail. Además, el análisis completo de los HTML grandes sigue limitado por el conector y las consultas de detalle de logs fallaron en backend.

## Sexta revisión: correos y callbacks OAuth

- `cita-email` v14, `cita-recordatorio` v13 y `cita-anulacion-reprogramacion` v12 interpolan texto de solicitud en HTML de correo mediante el simple reemplazo de saltos de línea por `<br>`. Esto permite introducir marcado HTML en los mensajes. Se añadieron candidatos que escapan `&`, `<`, `>`, comillas y apóstrofos antes del formato HTML; también aplican límites de cuerpo/mensaje y timeouts. `cita-email-v15-candidate.ts` sanea además controles CR/LF en el asunto y restringe CORS a la lista configurada.
- `cita-whatsapp` v13 permite cuerpos sin límite y su llamada Twilio no tiene timeout explícito. `cita-whatsapp-v14-candidate.ts` limita a 256 KB el cuerpo JSON, a 5.000 caracteres el mensaje, valida el teléfono E.164 y aplica timeout/CORS estricto.
- `gmail-oauth` v10 refleja en una plantilla HTML los parámetros de error de OAuth y usa una plantilla que interpolaba título/cuerpo sin escape. Se añadió `gmail-oauth-v11-candidate.ts`: escape HTML, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y timeout al intercambio de código.
- Pruebas ampliadas: TypeScript estático sin errores sobre 15 candidatos/archivos asociados; 13 grupos de invariantes; 9 pruebas de reglas de verificación de recibos; 10 pruebas de saneamiento de correo, nombres de esquema y HTML de OAuth; 7 pruebas de escape HTML de citas. Estas pruebas locales no invocan proveedores ni conectan a la base de datos real.
- Sigue pendiente una garantía de idempotencia para efectos externos: Gmail/Twilio pueden haber aceptado un envío aunque falle la escritura posterior en la base de datos o expire la conexión. Los candidatos evitan algunos reintentos idénticos cuando el proveedor admite una clave de idempotencia, pero no hacen transaccional el efecto remoto y la base de datos. Antes de resolverlo hay que implementar un registro de intentos/outbox con estados y reglas de recuperación, revisando esquema y flujos del cliente.

### Estado de la iteración
El paquete contiene 15 candidatos de función. El último `tsc --noEmit` finalizó con código cero y las cuatro baterías de pruebas terminaron aprobadas. El ZIP pasa `unzip -t`. No se ha desplegado ni migrado nada. No se declara producción libre de errores: siguen faltando pruebas en Deno/entorno Supabase aislado y navegador, confirmación de `ALLOWED_ORIGINS`, revisión integral de todos los endpoints activos, cuota de IA y diseño outbox/idempotencia de correo/WhatsApp.


## Séptima revisión: estado real de sincronización y HTML local

- La consulta SQL de sólo lectura confirmó 69 filas en `sintergia.sync_operations`, todas `operation=snapshot`, todas `status=applied`, con resultado y `completed_at`; sin embargo, `payload` y `result` son JSONB de tipo `string` (escalares que contienen JSON serializado), no objetos JSONB. El preview del resultado es una cadena con `{"accepted":true,"operation":"snapshot"}`.
- La tabla `sintergia.app_state` está vacía. La función SQL `sintergia.touch_app_state(text,jsonb,text)` sí contiene la lógica de insertar/actualizar estado, pero el `sync-operations` v12 activo sólo la invoca cuando `payload.state` existe. Si no existe, marca la operación como `applied` y devuelve `accepted:true` sin guardar estado. Además, el HTML de producción envía `upsert/delete` dentro de `body.operation`; la función activa responde como aceptado sin aplicar esa mutación. Esto constituye un falso acuse de sincronización y puede limpiar la cola local sin persistir la operación.
- El candidato `sync-operations-v13-candidate.ts` se actualizó con límites de cuerpo, casts explícitos `::jsonb` y fallback seguro: responde `405` a operaciones no soportadas o snapshots sin estado, aprovechando la lógica del HTML que reconoce `404/405` como endpoint opcional y mantiene la sincronización mediante snapshot completo. Los snapshots explícitos válidos se aplican con `touch_app_state` y el registro de resultado queda dentro de la misma transacción. Se añadieron 7 invariantes estáticos para este comportamiento.
- Inspección local del HTML disponible: `index.html` (3.224.672 bytes), `SintergiaSE_biometria_reparada_consolidada.html` (3.229.989 bytes) y `SintergiaSE_biometria_corregida_v3.html` (3.228.803 bytes) tienen 46 scripts inline cada uno. Los 138 scripts inline superaron `node --check` sin errores de sintaxis. `SINTERGIASE_BETA-13-1_biometria-corregida.html` tiene 22 scripts inline que también superaron `node --check`, además de 2 bibliotecas externas (jsPDF y html2canvas) que no se validaron localmente. Esto sólo comprueba sintaxis, no errores de ejecución ni el flujo completo de biometría.
- El HTML usa `register-biometric` y `authenticate-biometric`; no se modificó ninguno de esos endpoints ni el código biométrico. El usuario indicó que la biometría funciona y debe preservarse.
- No se alteraron datos de producción. Las consultas fueron de lectura. No se desplegó el candidato ni se cambió `app_state`; por tanto el hallazgo de sincronización sigue pendiente de aplicar y validar en una rama/instancia de pruebas.


## Iteración adicional: fallback de snapshot autenticado (2026-10-09)

- Al inspeccionar el HTML consolidado `SintergiaSE_biometria_reparada_consolidada.html`, se comprobó que `postOperation()` reutiliza `window.authHeadersSintergia()`, pero `postSnapshot()` no enviaba cabecera `Authorization`. La función activa `realtime-snapshot` valida un token Bearer personalizado, por lo que el fallback de snapshot podía fallar con HTTP 401 aunque la sesión siguiera autenticada.
- Preparada la copia `SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html`: `postSnapshot()` reutiliza las cabeceras de sesión, fija `Content-Type` y envía `X-Sintergia-Request-ID`. El HTML original no se sobrescribió y no se tocaron funciones biométricas.
- Verificación local: los 46 scripts inline de la copia pasan `node --check`; 13 grupos de invariantes generales, 9 pruebas de recibos, 10 de correo/IA/OAuth, 7 de HTML de citas y 7 de sincronización pasan; `unzip -t` confirma que el paquete reconstruido no tiene errores.
- Limitación: sigue pendiente probar con un token real de sesión en navegador y confirmar una escritura/lectura de `app_state` en entorno aislado. No se ha desplegado nada en Supabase ni cambiado ningún dato.

## Octava revisión: regresión del cliente y contrato de snapshot (2026-10-09)

- Se leyó en modo sólo lectura la versión activa `realtime-snapshot` v14. Confirma que exige el Bearer personalizado validado con HMAC; en un POST con `snapshot` de tipo objeto llama a `sintergia.touch_app_state(...)` y devuelve la versión, y en errores de BD devuelve HTTP 503. Esto respalda la corrección del HTML v4 que añade la cabecera de sesión al fallback.
- Se inspeccionó la definición SQL de `sintergia.touch_app_state(text,jsonb,text)` sin ejecutarla ni modificarla. La función fusiona el estado entrante con el estado previo, aplica reglas especiales a arrays de entidades y al campo `horario`, actualiza `serverMergedAt` y `syncSchema`, y aumenta la versión. Para `p_id='admin'` o `'tecnico'`, normaliza el ID canónico y replica el estado a ambos IDs.
- Se añadió `test-snapshot-auth-regression.cjs`. Resultado: PASS. La prueba ejecuta `postSnapshot()` extraído del HTML v4 con `rawFetch` simulado y verifica que reenvía `Authorization: Bearer ...`, el ID de solicitud, el canal y el identificador del cambio, y mantiene `credentials: 'omit'`.
- Esta prueba no se conecta a Supabase y no prueba un token real. El contrato de `realtime-snapshot` usa `b.id || t.sub || 'default'`; el cliente actual no manda `id`, así que la clave de estado depende del `sub` del token. Antes de pruebas reales hay que confirmar que ese `sub` coincide con la identidad/clave de estado que la app espera, especialmente para `admin`/`tecnico`, sin cambiar datos productivos.

### Confirmación de identidad de sesión y claves de estado

- La definición de `sintergia.auth_check(text,text,text)` confirma que el `id` devuelto procede de `sintergia.credentials.id` filtrado por `scope`; la Edge Function `authenticate` lo copia al claim `sub` del token.
- Consulta de sólo lectura de `sintergia.credentials` (sin leer hashes ni contraseñas): `modo` tiene IDs `admin`, `demo`, `tecnico`; `operacion` tiene ID `realtime`.
- Consecuencia observada en el código: los snapshots con sesión `admin` o `tecnico` se normalizan a `sintergia-operativo` y se replican a ambos IDs. Una sesión `demo` escribe bajo `demo`, y `realtime` bajo `realtime`. Esto puede ser intencional para separar modo demo y operaciones, pero debe verificarse en la aplicación: si `demo` debía compartir estado con `admin/tecnico`, actualmente no lo hace. No se cambió ninguna clave ni dato; `app_state` se había observado vacío en la auditoría anterior.
