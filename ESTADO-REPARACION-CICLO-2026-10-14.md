# Estado de reparación, validación y pendientes — SintergiaSE-APP

**Fecha de corte:** 14 de octubre de 2026  
**Paquete revisado:** SintergiaSE-APP-integral-corregido-2026-10-13-final.zip  
**SHA-256 del paquete de entrada:** 36AB2BE9E2622158911BBE64F417CC2671CBBF32C80E2FF83271AC551BF8E574  
**Archivos del ZIP:** 53  
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

No apareció un fallo reproducible en las comprobaciones locales, por lo que no se cambió la lógica de la aplicación en esta pasada. Se añadió este informe al paquete y a la rama de documentación indicada al final.

### Validación local repetida

- **19/19 suites CJS aprobadas:** appointment-html-rules, async-entrypoint-containment, biometric-error-containment, candidate-invariants, contract, email-security-rules, geo-lifecycle, gps-runtime-errors, inline-script-syntax, receipt-verification-rules, security-async-containment, snapshot-auth-regression, sw-guard, sync-client-regression, sync-flush-failures, sync-operations-rules, sync-p0-client-rules, sync-queue-retention y ui-live-duration-performance.
- **39/39 archivos JavaScript/TypeScript:** node --check sin errores.
- **JavaScript inline:** ambas páginas pasan la suite de sintaxis con 45 bloques por página.
- La suite del service worker confirma la versión de caché v7 y que los fallos de open, match y put de Cache Storage no bloquean la red.
- **CI remoto:** el workflow de la PR #2 terminó en success (ejecución 44); el workflow de la PR #3 terminó en success (ejecución 7). La PR #4 es solo documental y no tuvo workflow asociado en la consulta.

### Comprobación remota de GitHub

- La PR #2 de sincronización sigue abierta, sin fusionar y mergeable; su rama es fix/sync-p0-ack-and-durability-20261013, con head 90f4eb19fee8c11202de39447735492db8fd9b2b.
- La PR #3 de acciones UI sigue abierta y sin fusionar.
- La PR #4 de documentación sigue abierta en la rama docs/estado-aplicacion-2026-10-13. Este informe se añade a esa rama; main no se modifica.
- La PR #6 de fallback aparece abierta y con mergeable=false. Hay que resolver su estado de integración antes de intentar fusionarla.
- Ninguna comprobación confirma que el ZIP completo esté desplegado. No se cambió Supabase, sus datos, secretos ni funciones activas.

### Límite de la comprobación en navegador

Se intentó abrir la aplicación mediante el navegador de Codex desde un servidor local de revisión. El navegador devolvió ERR_BLOCKED_BY_CLIENT para 127.0.0.1. Se detuvo esa comprobación sin buscar una ruta indirecta. Por tanto, no se verificaron la consola, el render visual ni los flujos en un navegador real.

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

1. Repetir smoke test visual y revisión de consola en un navegador/entorno de QA que permita abrir la copia servida por HTTP.
2. Hacer un round-trip autenticado POST/GET en Supabase de pruebas con datos sintéticos y verificar sourceId/revision exactos, CORS, reintentos e idempotencia.
3. Probar en dos dispositivos la cola offline, reinicio, reconexión, tombstones, conflictos y cuota de almacenamiento.
4. Recorrer los flujos de avisos, partes, facturas, recibos, correo, biometría, REBT, O.C.A. y stock; registrar cada resultado.
5. Resolver la incompatibilidad indicada por mergeable=false en la PR #6 y revisar las PR abiertas antes de integrar.
6. Comparar el artefacto con la publicación real. No declarar la aplicación sin errores de producción hasta completar esas verificaciones.

## 6. Trazabilidad de esta entrega

Este mismo informe se incorpora al ZIP de salida y a la rama docs/estado-aplicacion-2026-10-13 de la PR #4. El paquete original permanece intacto. No se fusionó ninguna PR ni se desplegó la aplicación.
