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

Se revisaron el paquete ZIP, Estado_SintergiaSE_ubicaciones.md, cc.md.txt, ccc.md.txt, cccc.md.txt y la conversación enlazada «Revisa y corrige código web». Los documentos se trataron como contexto técnico y registro de cambios; sus afirmaciones históricas se distinguen de las verificaciones repetidas en esta iteración.

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
- Se añadió `test-technician-signature-durability.cjs`, que ejecuta el flujo extraído de ambas páginas con un trazo sintético y cubre clic en blanco, trazo, limpieza y fallos de almacenamiento.

### Validación local repetida

- **21/21 suites CJS aprobadas:** incluye las regresiones de colas durables y firma del técnico.
- **40/40 archivos JavaScript/TypeScript:** `node --check` sin errores.
- **JavaScript inline:** ambas páginas pasan la suite de sintaxis con 45 bloques por página.
- La suite del service worker confirma la versión de caché v7 y que los fallos de open, match y put de Cache Storage no bloquean la red.
- **CI remoto observado:** PR #2, ejecución 44, y PR #3, ejecución 7, terminaron en success. La ejecución 21 de PR #7 también fue success para el head anterior `00a726c`; no se observó todavía una ejecución para el head actualizado de esta pasada.

### Comprobación remota de GitHub

- La PR #2 de sincronización sigue abierta, sin fusionar y mergeable; su rama es fix/sync-p0-ack-and-durability-20261013, con head 90f4eb19fee8c11202de39447735492db8fd9b2b.
- La PR #3 de acciones UI sigue abierta y sin fusionar.
- La PR #4 de documentación sigue abierta en la rama docs/estado-aplicacion-2026-10-13 e incluye el informe de la pasada anterior. Esta actualización de firma queda en el paquete local de salida; la rama remota no se volvió a modificar y main permanece intacta.
- La PR #6 de fallback sigue abierta, en borrador y con `mergeable=false`. La comparación de ramas informa historias divergentes: 13 commits a cada lado desde `edbb625b120ee9b8335ba9b8263a42d48f3d5d97`. No se reescribió la rama.
- La PR #7 sigue abierta, en borrador y sin fusionar. Se añadieron a su rama las salvaguardas para la página secundaria, la nueva suite y el paso de CI en los commits `c72a9fe`, `977eb33` y `99b72fa`. GitHub informa ahora `mergeable=false`; la comparación con la rama base indica 18 commits por delante y 7 por detrás desde `344c2d59b7f7280e07e672f3c43df7206c208d0e`. El CI verde anterior pertenece al head viejo; queda comprobar la nueva revisión y reconciliar la divergencia antes de integrar.
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
- **REBT y O.C.A.:** validación técnica/normativa y de evidencias en contexto real.
- **Stock:** integridad del catálogo de fabricantes, materiales e imágenes.
- **Publicación:** URL activa, rama y artefacto reales de Cloudflare Pages/GitHub Pages y contenido de Cloud Shell.

La consulta que el informe histórico de iteración 7 atribuye a Supabase —71 filas con payload/result JSONB escalares y app_state vacío— no se repitió aquí; debe considerarse un dato histórico pendiente de verificación.

## 5. Próximas acciones

1. Repetir smoke test visual, revisión de consola y acceso/firma en un navegador/entorno de QA con backend de pruebas.
2. Hacer un round-trip autenticado POST/GET en Supabase de pruebas con datos sintéticos y verificar sourceId/revision exactos, CORS, reintentos e idempotencia.
3. Probar en dos dispositivos la cola offline, reinicio, reconexión, tombstones, conflictos y cuota de almacenamiento.
4. Recorrer los flujos de avisos, partes, facturas, recibos, correo, biometría, REBT, O.C.A. y stock; registrar cada resultado.
5. Reconciliar y revisar la divergencia de la PR #6 con la rama actual de la PR #2; después, revisar los conflictos de #7 contra el head actual de #6 antes de integrar.
6. Comparar el artefacto con la publicación real. No declarar la aplicación sin errores de producción hasta completar esas verificaciones.

## 6. Trazabilidad de esta entrega

Este informe se incorpora al ZIP de salida. La salida incluye ambas páginas reparadas, las suites de regresión y este registro; el paquete de entrada de 53 archivos permanece intacto. No se fusionó ninguna PR, no se modificó main ni se desplegó la aplicación.


