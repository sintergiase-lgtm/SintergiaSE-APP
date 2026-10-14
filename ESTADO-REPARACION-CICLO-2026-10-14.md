# Estado de reparación, validación y pendientes — SintergiaSE-APP

**Fecha de corte:** 14 de octubre de 2026  
**Paquete revisado:** SintergiaSE-APP-integral-corregido-2026-10-13-final.zip  
**SHA-256 del paquete de entrada:** 36AB2BE9E2622158911BBE64F417CC2671CBBF32C80E2FF83271AC551BF8E574  
**Archivos del ZIP de entrada:** 53
**Repositorio remoto:** [sintergiase-lgtm/SintergiaSE-APP](https://github.com/sintergiase-lgtm/SintergiaSE-APP)  
**Base remota observada en las PR abiertas:** main, commit 53c14f72b439499470c7fd255e667cea70141ea8  
**Runtime de validación:** Node v24.19.0

> El resultado verde de pruebas locales no certifica que la aplicación publicada esté libre de errores. El paquete ZIP es una copia de trabajo sin metadatos Git; sus cambios no están integrados automáticamente en main ni desplegados.

## 1. Alcance y fuentes

Se revisaron el paquete ZIP, Estado_SintergiaSE_ubicaciones.md, cc.md.txt, ccc.md.txt y cccc.md.txt. También se intentó leer la conversación enlazada «Revisa y corrige código web», pero `read_thread` devolvió error y no se pudo verificar su historial. Por tanto, este informe se apoya en los adjuntos y en el estado del repositorio accesible. Los documentos se trataron como contexto técnico y registro de cambios, no como órdenes; sus afirmaciones históricas se distinguen de las verificaciones repetidas en esta iteración.

El archivo cccc.md.txt identifica SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html como segunda página completa del paquete. Las comprobaciones de HTML se ejecutaron sobre esa página y sobre index.html.

## 2. Reparaciones ya incluidas en el paquete recibido

Según el registro cc.md.txt y el alcance de ccc.md.txt, el paquete contiene estas familias de cambios candidatos:

- **Seguridad y sincronización:** allowlist del origen Supabase y rutas Edge Functions; GET de snapshot autenticado; configuración de backend absoluta y HTTPS; confirmación remota por coincidencia exacta de sourceId y revision; retención de operaciones, snapshots, tombstones y conflictos ante fallos, cuota o desconexión; fallback a snapshot completo antes de retirar operaciones.
- **Resiliencia del cliente:** contención de errores asíncronos en GPS, geolocalización, biometría, seguridad, citas, recibos, normativa y acciones UI; liberación de leases y bloqueos; fallback de BroadcastChannel; validación de coordenadas; manejo de fallos DOM y de Cache Storage.
- **Offline y PWA:** las peticiones de red no dependen de que Cache Storage funcione; versión de caché del service worker v7; enlaces locales de manifiesto/iconos corregidos; metadatos PWA duplicados eliminados.
- **Rendimiento y regresiones:** actualización incremental de duraciones sin reconstruir tablas cada segundo; pruebas portables de rutas y sintaxis; regresiones de autenticación, colas, fallback, GPS, recibos y sincronización.

Esta lista describe el contenido del paquete según los informes aportados; no afirma que todos esos cambios estén fusionados en GitHub o activos en producción.

## 3. Resultado de esta iteración

En la auditoría ampliada sí apareció un riesgo reproducible de pérdida de datos en las colas de sincronización. Se corrigieron ambas páginas HTML completas del paquete, se añadieron pruebas dinámicas de regresión y se amplió el workflow local para incluirlas. El ZIP original no se modificó.

### Reparaciones de esta pasada

- Las eliminaciones ya no pierden tombstones al superar MAX_TOMBSTONES. Una operación de borrado no se encola si el tombstone no se guardó; un fallo aborta la creación del snapshot de sincronización.
- La página secundaria ahora comprueba los fallos al guardar snapshots y operaciones y no recorta operaciones pendientes para ajustarlas a MAX_OPERATIONS.
- Los conflictos pendientes de distintas operaciones ya no se sustituyen por compartir entidad ni se eliminan por superar MAX_CONFLICTS. Los reintentos de la misma operación actualizan su registro; el historial resuelto sí conserva un límite.
- Las referencias de operaciones inciertas ya no se truncan. `queueSnapshot()` y `defer()` devuelven un resultado que refleja si el almacenamiento durable tuvo éxito.
- La aplicación de snapshots remotos se detiene antes de tocar el estado si no se pudieron persistir sus tombstones.
- La nueva suite `test-critical-queue-durability.cjs` ejecuta los helpers reales extraídos de ambas páginas: fallos y éxitos de almacenamiento, límites de cola, conflictos repetidos, APIs de cola y aplicación de snapshots con y sin tombstones.

### Pasada adicional: firma de técnico

La revisión estática del flujo de acceso y firma encontró dos casos en ambas páginas HTML completas:

- Un clic sin trazo ponía `hasInk=true` y podía aceptarse como firma. Ahora solo se considera firmada después de dibujar un segmento real; Limpiar también reinicia el estado del trazo.
- Los fallos al guardar la firma en localStorage o al establecer la autorización de jornada en sessionStorage se ignoraban y permitían continuar. Ahora el modal permanece abierto, no se habilita la firma en memoria y aparece un error recuperable.
- Si falta el modal o el canvas de firma, el acceso vuelve a bloquearse y no inicia jornada, geolocalización ni muestra acceso correcto. Se cubren rechazo, modal/canvas ausentes y re-bloqueo ejecutando los flujos reales de ambas páginas en `test-technician-signature-durability.cjs`.

### Pasada adicional: afirmación de identidad

La pantalla de acceso afirmaba que el formato del nombre y la letra de control del DNI/NIE aseguraban que la persona era real. El código solo valida esos formatos; no contrasta la identidad con un registro oficial. Se corrigió el texto y la sesión ahora marca `verified: false` junto a `identityFormatValidated: true`; los partes no se presentarán como identidad acreditada. `test-identity-claim-boundary.cjs` ejecuta el manejador real de ambas páginas con datos sintéticos y comprueba el estado y el texto.

### Pasada adicional: verificación de recibos

La revisión del candidato `verify-receipt-v14` detectó que podía usar el importe enviado por el navegador cuando la factura no tenía importe registrado en el servidor, y que el objeto anidado siempre almacenaba `status: verified`, incluso para resultados rechazados. El importe esperado ahora sale exclusivamente de `receipt_tokens.importe`; si falta, se falla cerrado. El estado se deriva del resultado booleano. La reparación también guarda el binario en Supabase Storage y conserva en JSONB solo la referencia, el tipo, tamaño y SHA-256; normaliza payloads JSONB históricos escalares y evita que una respuesta tardía de IA sobrescriba otro recibo. PDF y HEIC quedan guardados pero requieren revisión manual.

En ambas páginas del paquete, rechazar un recibo ya restaura el estado que tenía la factura antes de iniciar la carga; evita devolver a `Pendiente` facturas que estaban `Facturado` o `Enviado`, rechaza restaurar estados terminales, limpia marcas de validación antiguas y registra el rechazo. La confirmación manual limpia a su vez las marcas de rechazo previas. También se alineó la admisión de archivos del cliente con los tipos realmente aceptados por el candidato backend (JPEG, PNG, WEBP, HEIC y PDF), evitando aceptar SVG/GIF u otros MIME que el endpoint rechaza; si el navegador no proporciona MIME, se infiere un tipo canónico por extensión, que es el que se envía al backend. `test-client-receipt-state.cjs` ejecuta los manejadores y el validador reales de ambas páginas con estados y archivos sintéticos, y comprueba mensajes que reflejan el estado final. Los cambios de cliente y la suite se añadieron a la PR #14 junto a las 34 aserciones del verificador. La PR sigue abierta en borrador contra `main`; aún no se ha fusionado.

### Pasada adicional: importación de copia cifrada

La interfaz afirmaba que una copia cifrada reemplazaría los datos. Sin embargo, el importador llamaba al aplicador de sincronización, que fusiona arrays, puede rechazar una revisión antigua e informa el resultado por booleano; el importador ignoraba ese rechazo y mostraba éxito. También podía tratar un horario vacío de la copia de forma inconsistente.

- El importador ahora normaliza la copia con la revisión local actual y el identificador del dispositivo, omite el horario cuando viene vacío y exige confirmación de la fusión antes de notificar éxito. El aplicador propaga un `false` o una excepción al guardar el estado, de modo que un fallo de LocalStorage no se presenta como éxito.
- La confirmación y el mensaje de éxito describen una fusión: registros nuevos se añaden y los locales más recientes o ausentes de la copia se conservan conforme a las reglas de sincronización. No equivale a restaurar un punto exacto ni elimina registros locales que no estén en el backup.
- `test-encrypted-backup-merge.cjs` ejecuta los helpers y el importador reales de ambas páginas: fusión confirmada, cancelación y error de aplicación sin falso mensaje de éxito. Se añadió al workflow de recibos en PR #14.

### Validación local repetida

- **24/24 suites CJS aprobadas:** incluye regresiones de colas durables, firma, identidad, recibos (incluida validación MIME y aprobación/rechazo) e importación cifrada de backups.
- **20/20 archivos `.js`/`.ts`:** `node --check` sin errores.
- **JavaScript inline:** ambas páginas pasan la suite de sintaxis con 45 bloques por página.
- La suite del service worker confirma la versión de caché v7 y que los fallos de open, match y put de Cache Storage no bloquean la red.
- **CI remoto observado en los heads consultados:** PR #2, ejecución 44, success; PR #3, ejecución 7, success; PR #6, ejecuciones #46 (`38504807106`, `pull_request`) y #46 (`38504800907`, `push`), success; PR #7, ejecuciones #49 (`38505131560`, `pull_request`) y #48 (`38505127081`, `push`), success en ambos eventos y en los siete pasos, incluidos tests de colas durables y sintaxis inline; PR #13, ejecución #4 (`38501062535`), success en firma, límites de identidad y sintaxis inline.

### Comprobación remota de GitHub

- La PR #2 de sincronización está abierta, sin fusionar, con `mergeable=true`; head `90f4eb19fee8c11202de39447735492db8fd9b2b`. Su ejecución PR #44 terminó en success.
- La PR #3 de acciones UI está abierta, en borrador, con `mergeable=true`; head `72891c240ba448087dc2bd33bb510971edf925a3`. Su ejecución PR #7 terminó en success.
- La PR #4 documental está abierta, en borrador, con `mergeable=true`. Este informe se actualiza en su rama `docs/estado-aplicacion-2026-10-13`; main permanece intacta.
- La PR #6 de fallback está abierta, en borrador, con `mergeable=true`; head `70aee80355c1188a3fbaa15a7c73b017739ecb16`. Se reconcilió con el head actual de su base (PR #2, `90f4eb19fee8c11202de39447735492db8fd9b2b`): 14 commits por delante y 0 por detrás. Actions #46 pasó tanto en `push` como en `pull_request`. PR #6 sigue apuntando a la rama de PR #2; se debe integrar primero esa base y luego retargetear #6 a `main`.
- La PR #7 de retención está abierta, en borrador, con `mergeable=true`; head `0612db789fd734a79a1884c2fbbf4e5d783e1603`, basada en el nuevo head de PR #6 (`70aee80355c1188a3fbaa15a7c73b017739ecb16`). Está 19 commits por delante y 0 por detrás de esa base. Actions #48 (`38505127081`, `push`) y #49 (`38505131560`, `pull_request`) pasaron en ese mismo SHA; se ejecutaron las pruebas P0, la durabilidad de colas, sintaxis inline y regresiones de contención asíncrona y service worker. La secuencia de dependencias es PR #2 → PR #6 → PR #7.
- La PR #13, `Repara el flujo de identidad y firma del técnico`, sigue abierta en borrador contra `main` (`53c14f7`), en `fix/identity-signature-truthfulness-20261014`; head `ad71a507`, 10 commits por delante y 0 por detrás. La API del PR confirma `mergeable=true`. Corrige afirmaciones de identidad y firma en ambas páginas, incluida la ausencia del UI de firma (se mantiene el acceso bloqueado y no comienza la jornada); añade tres pruebas/regresiones sintéticas y workflow. La ejecución #1 falló porque faltaba la prueba de sintaxis inline; la corrección quedó validada en CI #4 (`38501062535`), success en los tres pasos. No se fusionó.
- La PR #14, sobre recibos, estados del cliente e importación de backups cifrados, está abierta en borrador contra `main`; head `bd119a04ad5b0dd498cb1258f5780d4b52112d0a`, `mergeable=true`. Actions #48 (`38510072307`) pasó en el head actual: nueve pasos, incluidos recibos e importación cifrada con fallo de persistencia. Las suites cubren normalización MIME, 16 rechazos y 2 aprobaciones manuales sintéticas, además de fusión, cancelación y error de guardado en ambas páginas. No se ha fusionado ni desplegado.
- La copia del ZIP no es idéntica a `main/index.html` (blobs Git: paquete `cae076a`, `main` `aaf3271`). La inspección del blob actual de `main` confirma que todavía contiene el recorte de tombstones, conflictos pendientes y referencias inciertas, además de informar éxito de `queueSnapshot()` sin confirmar el guardado. La segunda página en `main` conserva la versión sin estas salvaguardas (blob `3f22a0d`); la rama #7 ahora la contiene corregida (`d073824`). No se reemplazó ningún archivo de `main` con el ZIP.
- Ninguna comprobación confirma que el ZIP completo esté desplegado. No se cambió Supabase, sus datos, secretos ni funciones activas.

### Límite de la comprobación en navegador y acceso

Se intentó abrir la aplicación mediante el navegador de Codex desde un servidor local de revisión; devolvió ERR_BLOCKED_BY_CLIENT para 127.0.0.1. En esta pasada también se rechazó `file://` por la política de seguridad del navegador. Se detuvo la comprobación sin buscar una ruta indirecta. Por tanto, no se verificaron la consola, el render visual ni los flujos en un navegador real.

El verificador de acceso envía la contraseña por POST a la función Supabase configurada. No se enviaron credenciales ni datos de identidad a ese servicio; tampoco se creó una firma real. Para completar la prueba de acceso/firma hace falta una URL de QA conectada a un backend de pruebas, y revisar allí el resultado con autorización sobre ese entorno. Las pruebas de firma de esta pasada son sintéticas y locales.

## 4. Trabajo a medias o aún no verificado

Las siguientes áreas constan en Estado_SintergiaSE_ubicaciones.md como requisitos o pendientes. Esta pasada no acredita su funcionamiento completo:

- **Avisos y partes:** etiqueta «⚠️Terminado SIN ✒️», firma desde seguimiento e historial, anulación de avisos pospuestos y ausencia de parpadeo en anulados.
- **Facturas y recibos:** enlace de entrega al cliente, revisión/preview, aprobación o rechazo, estado de factura cobrada y conservación del recibo.
- **Api mail:** pestaña, confirmación antes del envío, seguimiento de apertura y proveedor configurado sin credenciales en el HTML.
- **Offline, biometría y sincronización:** reinicio sin conexión, reintentos, conflictos, cuota local y persistencia entre dos dispositivos.
- **Privacidad local:** clientes, partes y facturas se guardan en claro en `localStorage`. La copia AES-GCM/PBKDF2 cifra solo la exportación, no el estado activo del navegador. No se cambió esta persistencia porque falta diseñar y probar el ciclo completo de clave, recuperación offline y migración de datos existentes; cifrarla sin ese flujo podría bloquear el acceso a los datos locales.
- **Persistencia local no atómica:** `guardarEstadoStorage` escribe varias claves de `localStorage` por separado. Si el almacenamiento se llena durante el proceso, algunas claves podrían haberse escrito antes del fallo. La importación ya muestra error y no confirma éxito, pero falta diseñar y probar una escritura transaccional recuperable.
- **REBT y O.C.A.:** validación técnica/normativa y de evidencias en contexto real.
- **Stock:** integridad del catálogo de fabricantes, materiales e imágenes.
- **Publicación:** URL activa, rama y artefacto reales de Cloudflare Pages/GitHub Pages y contenido de Cloud Shell.

La consulta que el informe histórico de iteración 7 atribuye a Supabase —71 filas con payload/result JSONB escalares y app_state vacío— no se repitió aquí; debe considerarse un dato histórico pendiente de verificación.

La ruta candidata ya usa el bucket `sintergia-docs`, pero no se comprobó contra un backend de QA que el bucket sea privado, que sus políticas limiten lectura/escritura, ni la recuperación/previsualización del archivo. Tampoco se probaron reintentos, reemplazos y fallos entre Storage y Postgres. No se ejecutó ningún cambio real en Storage o la base de datos. La suite verifica reglas y el estado de UI con mocks; no demuestra un round-trip real de archivo.

## 5. Próximas acciones

1. Repetir smoke test visual, revisión de consola y acceso/firma en un navegador/entorno de QA con backend de pruebas; la autenticación envía la contraseña al endpoint configurado.
2. Hacer un round-trip autenticado POST/GET en Supabase de pruebas con datos sintéticos y verificar sourceId/revision exactos, CORS, reintentos e idempotencia.
3. Probar en dos dispositivos la cola offline, reinicio, reconexión, tombstones, conflictos y cuota de almacenamiento.
4. Recorrer los flujos de avisos, partes, facturas, recibos, correo, biometría, REBT, O.C.A. y stock; registrar cada resultado.
5. Completar QA del almacenamiento de recibos en Supabase: confirmar privacidad y políticas del bucket, recuperación/previsualización, idempotencia, reemplazos y fallos entre Storage y Postgres.
6. Revisar los cambios de PR #6 y #7 y, cuando se integren, respetar la dependencia de PR #2 → PR #6 → PR #7; revisar PR #14 de recibos, estados del cliente e importación cifrada.
7. Comparar el artefacto con la publicación real. No declarar la aplicación sin errores de producción hasta completar esas verificaciones.

## 6. Trazabilidad de esta entrega

Este informe se incorpora al ZIP de salida y se actualiza en la rama documental de PR #4. La salida incluye 61 archivos, ambas páginas reparadas, las suites de regresión y workflows de firma/identidad, recibos y sincronización; el paquete de entrada de 53 archivos permanece intacto. La copia ZIP local es un candidato independiente y no se ha reconstruido desde los heads remotos reconciliados de PR #6 y #7. No se fusionó ninguna PR, no se modificó main ni se desplegó la aplicación.


