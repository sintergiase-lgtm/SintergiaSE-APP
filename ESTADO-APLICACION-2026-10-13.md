# SintergiaSE APP — estado técnico, reparaciones y trabajo pendiente

**Fecha de corte:** 13 de octubre de 2026  
**Repositorio:** [sintergiase-lgtm/SintergiaSE-APP](https://github.com/sintergiase-lgtm/SintergiaSE-APP)  
**Rama de referencia:** `main`  
**Commit de referencia:** `53c14f72b439499470c7fd255e667cea70141ea8`  
**Aplicación publicada:** https://sintergiase-lgtm.github.io/SintergiaSE-APP/  
**Backend documentado:** Supabase, proyecto `bgjicsowspppsjzigazb`

> Este informe distingue el estado comprobado del repositorio de los resultados de auditorías históricas y de las pruebas aún pendientes. No certifica que producción esté libre de errores. Las ramas de reparación indicadas aquí no están fusionadas en `main`.

## 1. Resumen ejecutivo

La aplicación es un frontend web grande concentrado principalmente en `index.html` (aprox. 3,2 MB de texto), acompañado por un service worker, archivos PWA, módulos auxiliares y numerosos candidatos de Edge Functions. El repositorio también contiene informes de auditoría y pruebas estáticas.

El riesgo más importante documentado es la **confirmación de sincronización sin evidencia suficiente de persistencia real**. La auditoría histórica del 12 de octubre registró 0 filas en `sintergia.app_state` y 71 filas en `sintergia.sync_operations`; las 71 aparecían como `applied`, pero `payload` y `result` estaban guardados como escalares JSONB de tipo cadena, no como objetos. Esos datos no demuestran que el estado funcional se hubiera persistido. Esta observación procede del informe previo; no se ha repetido una consulta de base de datos en esta revisión.

Hay dos reparaciones de frontend abiertas en propuestas separadas:

- **PR #2 — sincronización:** [Fix P0 de sincronización](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2). Preserva las colas pendientes, maneja operaciones antiguas/incompletas mediante fallback a snapshot y exige coincidencia exacta de `sourceId` y `revision` al confirmar el estado remoto. Las comprobaciones estáticas y las simulaciones locales al análisis pasan; faltan Node en un checkout limpio y el round-trip autenticado real.
- **PR #3 — acciones de partes:** [Corregir etiquetas y estados operativos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/3). Sustituye las tres etiquetas `⚠️GUARDA⚠️` por `⚠️GUARDAR⚠️` y añade `en trayecto` a la condición de acción única `👷🏻‍♂️🛠️` para partes directos, incluyendo etiquetas accesibles correctas. Añade pruebas de regresión estáticas. Está en borrador y pendiente de revisión.

Ninguna de estas propuestas está fusionada ni desplegada. Las pruebas estáticas no sustituyen las pruebas de navegador, de dos dispositivos o contra Supabase.

## 2. Qué existe y se ha realizado

### 2.1 Repositorio y estructura

**Comprobado en GitHub:**

- El repositorio es público, está activo y la rama predeterminada es `main`.
- Hay varias ramas de trabajo, incluidas `audit/correcciones-2026-10-13` y `fix/sync-p0-ack-and-durability-20261013`.
- `index.html` contiene la interfaz y una cantidad importante de lógica de cliente, incluida sincronización, estados de partes/avisos, facturación, rutas, citas y otras funciones.
- `sw.js`, `offline-guard.js`, `offline-login-bridge.js`, `manifest.webmanifest` y pruebas `test-*.cjs` forman parte del árbol.
- La raíz incluye candidatos TypeScript para sincronización, recibos, documentos, correo, citas, OAuth y pasarela de IA. Su presencia en el repositorio no significa que estén desplegados.
- Existen documentación de despliegue y varios informes previos: `DEPLOY.md`, `ITERACION-7-HALLAZGOS.md`, `README-SintergiaSE-reparaciones-candidatas.md` y `SintergiaSE-auditoria-2026-10-09.md`.

### 2.2 Service worker / guardia offline

En la versión actual de `main`, `sw.js` usa la caché `sintergiase-shell-v6` e inserta una etiqueta de script cuyo cierre es literal `</script>`. La inyección defectuosa señalada en `ITERACION-7-HALLAZGOS.md` ya no coincide con el código actual de `sw.js`; ese hallazgo debe marcarse como **corregido en el código fuente**, no como validado en runtime.

Queda por verificar en navegador que:
1. el service worker nuevo se instala y activa;
2. `offline-guard.js` se ejecuta en el orden previsto;
3. las respuestas de API/autenticación no se guardan en caché;
4. una caché anterior se sustituye sin afectar los datos locales;
5. el shell arranca tanto online como offline después de haber sido cargado previamente.

### 2.3 Reparación P0 de sincronización propuesta en PR #2

Archivos afectados: `index.html` y `test-sync-p0-client-rules.cjs`.

La rama de reparación propone:

- no truncar las colas pendientes de cambios, operaciones, API diferida, conflictos y tombstones;
- no eliminar automáticamente cambios pendientes para liberar cuota;
- conservar las entradas locales si no se pudo persistir una cola;
- tratar ciertos errores de operaciones heredadas/incompletas como motivo para intentar el fallback de snapshot, sin retirar la operación pendiente como si hubiera sido aplicada;
- validar la escritura/lectura remota antes de indicar que el modo multidispositivo está confirmado;
- exigir que la revisión remota coincida exactamente con la revisión local y no aceptar una revisión remota superior como prueba de que se guardó el snapshot que acaba de enviarse;
- limitar el helper de backend al origen Supabase configurado y a rutas Edge Functions.

**Comprobaciones realizadas en esta revisión de la rama candidata:**

- 12 invariantes estáticas comprobadas;
- 3 escenarios de fallback simulados: `legacy_sync_record_requires_reconciliation`, `operation_incomplete` y `snapshot_payload_required`;
- un 503 genérico continúa siendo un error reintentable en la simulación;
- 46 scripts JavaScript inline analizados sin errores de sintaxis.

**No equivale a una prueba completa:** no se ejecutó `node test-sync-p0-client-rules.cjs` en un checkout real, ni se hizo un POST/GET autenticado contra Supabase, ni una prueba con dos dispositivos. La PR #2 sigue abierta.

### 2.4 Corrección de acciones de partes propuesta en PR #3

Archivo: `index.html`; prueba añadida: `test-status-action-labels.cjs`.

En `main` se localizaron tres etiquetas visibles `⚠️GUARDA⚠️` en acciones asociadas al guardado de partes firmados. El requisito solicitado es `⚠️GUARDAR⚠️`. Además, la rama `esParteDirecto` no incluía `en trayecto` en la condición de acción única para los estados operativos. La rama propuesta corrige las tres etiquetas, añade `en trayecto` y ajusta `title`/`aria-label` para que describan correctamente el trayecto.

Validación estática de la rama:
- tres etiquetas correctas;
- cero etiquetas antiguas;
- 46 scripts inline sin errores de sintaxis;
- prueba de regresión añadida.

La PR #3 está en borrador, no está fusionada y su prueba Node debe ejecutarse en un checkout real. Tampoco se ha validado aún el comportamiento del botón en un navegador.

## 3. Qué está a medias o requiere reconciliación

### 3.1 Persistencia de sincronización y datos históricos — P0

**Evidencia histórica:** `ITERACION-7-HALLAZGOS.md` registra 0 filas en `sintergia.app_state` y 71 filas en `sintergia.sync_operations`, todas con estado `applied`, pero con `payload/result` JSONB de tipo cadena. El informe de 9 de octubre registraba 69 filas; la diferencia confirma que las cifras dependen de la fecha de consulta.

**Pendiente:**
- consultar de nuevo el estado real del proyecto Supabase;
- confirmar la versión desplegada actualmente de `sync-operations` y `realtime-snapshot`;
- hacer un POST autenticado con datos sintéticos y verificar el GET posterior;
- verificar que la cola local solo retire un elemento después de un acuse válido y persistido;
- probar reintentos idénticos, reutilización de ID con contenido distinto, concurrencia, 401/403/5xx, desconexión y recuperación;
- reconciliar los registros históricos con backup y estrategia de recuperación; no borrarlos ni marcarlos como válidos automáticamente.

### 3.2 Merge de colecciones, concurrencia y tombstones — P0/P1

Los informes previos describen merge especial para `clientes`, `partes`, `facturas`, `pendientes`, `stock`, `stockListas`, `compras`, `horario` y `tombstones`. También señalan que otras colecciones, por ejemplo avisos y rutas, podrían quedar expuestas a sobrescrituras por snapshots antiguos.

**Pendiente:** inventariar las claves reales de `appState`, definir reglas de fusión y versionado por colección y probar ediciones simultáneas, borrados, dispositivos desconectados durante días y reconexión con snapshots antiguos.

### 3.3 Estado de los candidatos backend

La raíz incluye candidatos como `sync-operations-v13-candidate.ts`, `verify-receipt-v14-candidate.ts`, `receipt-register-v13-candidate.ts`, `upload-receipt-v12-candidate.ts`, `upload-doc-v12-candidate.ts`, `invoice-return-v12-candidate.ts`, `cita-respuesta-v11-candidate.ts`, `ai-gateway-v14-candidate.ts` y otros módulos de correo/citas/OAuth.

La documentación informa de compilaciones y pruebas estáticas de candidatos. **No debe inferirse que estén desplegados** por estar presentes en GitHub. Además, los informes de fechas diferentes citan versiones activas distintas de algunas Edge Functions; se necesita consultar el despliegue real antes de aplicar cualquier candidato.

**Pendiente:** comprobar cada función activa, revisar el diff candidato frente al código desplegado, ejecutar pruebas integradas en entorno aislado y desplegar de forma escalonada con plan de reversión.

### 3.4 Recibos, documentos y facturación — P1

Los informes anteriores señalan riesgos a comprobar en:
- verificación de recibos que no debe aprobar si faltan pruebas explícitas de referencia e importe;
- registro de tokens que debe impedir la reasignación del mismo token a otra factura;
- límites de tamaño antes de procesar JSON/Base64;
- limpieza de objetos de Storage si falla el registro de metadatos;
- escrituras atómicas para devoluciones;
- distinción entre recibo registrado y recibo verificado.

**Pendiente:** ejecutar casos de datos ausentes, importe/referencia incorrectos, archivos inválidos, payload excesivo, errores de Storage/BD y reintentos concurrentes. No desplegar candidatos sin confirmar esquema y secretos actuales.

### 3.5 CORS, sesiones y autorización — P1

Los informes previos describen funciones con reflejo del encabezado `Origin` o fallback permisivo cuando `ALLOWED_ORIGINS` está vacío. Varias funciones usan `verify_jwt=false` porque validan una sesión HMAC propia; esto no demuestra por sí solo una vulnerabilidad, pero exige comprobar autenticación, alcance de sesión y autorización en cada endpoint.

**Pendiente:** confirmar los orígenes HTTPS reales (GitHub Pages, dominio propio y contenedor móvil si aplica), configurar una allowlist explícita, probar preflight/POST desde orígenes permitidos y no permitidos y distinguir errores de sesión de fallos de infraestructura. No cambiar CORS a ciegas: podría bloquear usuarios legítimos.

### 3.6 Correo, citas e IA — P1

- El envío de correo puede duplicarse si el proveedor acepta el mensaje y falla después el registro local.
- Los enlaces de respuesta a citas deben evitar mutaciones automáticas por GET, porque los escáneres de correo pueden abrirlos.
- La pasarela de IA requiere límites de tamaño, tiempo, modelos permitidos y consumo por sesión.

**Pendiente:** outbox/idempotencia con estado de resultado incierto para correo; confirmación explícita por POST para respuestas a citas; cuotas y límites probados para IA; tests con timeout, 429, 5xx y reintentos.

### 3.7 Autenticación biométrica y acceso offline — P1/P2

Hay módulos de autenticación/biometría y código offline en el repositorio, pero la auditoría estática no acredita un flujo offline seguro ni que todas las versiones desplegadas coincidan con las documentadas.

**Pendiente:** mantener biometría fuera de los cambios de sincronización hasta probar registro/login online, reinicio de PWA en modo avión, caducidad del permiso offline y resincronización posterior. No tratar `localStorage` por sí solo como prueba de identidad. No modificar claves, secretos o políticas RLS sin una revisión específica.

### 3.8 Reglas de estados y botones de partes/avisos — P1

En el HTML actual hay lógica para los filtros y estados `⚠️Terminado SIN ✒️`, `Terminado✒️ SIN GUARDAR`, `Factura emitida pendiente cobro` y botones `👷🏻‍♂️🛠️`. Sin embargo, la presencia de texto en el código no prueba que todas las combinaciones de estado y acciones sean correctas.

**Estado comprobado en esta revisión:**
- `⚠️GUARDAR⚠️` no aparecía en `main`; se detectaron tres etiquetas `⚠️GUARDA⚠️`. La corrección se propone en PR #3.
- `Realizado pendiente firma` no aparece como literal exacto en la versión consultada de `main`; el código usa normalizaciones/etiquetas distintas.
- Las etiquetas de estado y botones de trabajo aparecen en el HTML, pero no se ha ejecutado una matriz de pruebas en navegador que cubra todas las filas de Historial de Partes y Seguimiento de Avisos.

**Pendiente de prueba funcional:**
1. estado `⚠️Terminado SIN ✒️`: botón de firma situado a la izquierda de enviar correo, y ocultación de las acciones no permitidas;
2. estado firmado pendiente de guardar: texto `⚠️GUARDAR⚠️`, parpadeo de advertencias y eliminación de correo/editar/anular/acciones ocultas no aplicables;
3. `en trayecto`, `aparcado` y `realizándose`: botón `👷🏻‍♂️🛠️` que abre la pestaña Parte y ninguna acción extra;
4. estados anulados: botón de restaurar `♻️` que devuelve el registro al estado previo;
5. Pospuesto: sin botón eliminar en Seguimiento de Avisos;
6. sincronización entre Historial de Partes y Seguimiento de Avisos para cada transición;
7. todas las advertencias `⚠️` deben parpadear donde se ha solicitado, respetando `prefers-reduced-motion`.

### 3.9 Documentación de despliegue — P2

`DEPLOY.md` muestra comandos con rutas `supabase/functions/sync-operations/test-contract.cjs` y `supabase/functions/sync-operations/index.ts`, mientras que los archivos candidatos consultados están en la raíz del repositorio. Es una discrepancia documental que puede hacer fallar los comandos desde la raíz.

**Pendiente:** alinear la guía con el árbol real o documentar la estructura de despliegue que debe crear Cloud Shell. No desplegar hasta que los comandos se hayan probado en un checkout limpio y en un proyecto de pruebas.

## 4. Riesgos que no se deben dar por resueltos

- Los informes de auditoría son de fechas distintas y algunos recuentos/versiones no coinciden. La versión activa debe verificarse en Supabase.
- Los candidatos no son producción hasta que se comparen con la función activa y se desplieguen expresamente.
- Los tests estáticos no demuestran persistencia real, seguridad de sesión, aislamiento de usuarios ni consistencia multidispositivo.
- La consulta de datos históricos fue de solo lectura en los informes citados; no se han reconciliado ni eliminado registros.
- No se ha realizado en esta revisión un despliegue, migración, modificación de secretos, cambio de RLS ni cambio de funciones biométricas.

## 5. Plan de reparación en bucle

Cada iteración debe cerrar con evidencia reproducible y actualizar este informe:

1. **Reproducir:** fijar rama/commit, caso de prueba y resultado actual.
2. **Aislar:** localizar archivo, función, endpoint y datos mínimos de prueba.
3. **Reparar:** crear una rama corta; no modificar `main` directamente.
4. **Probar estáticamente:** sintaxis, invariantes y regresiones automatizadas.
5. **Probar integración:** entorno Supabase aislado, datos sintéticos y credenciales de prueba.
6. **Probar UI:** navegador limpio, móvil/escritorio y, para sync, dos dispositivos.
7. **Revisar impacto:** colas, estados, datos históricos, caché offline y compatibilidad hacia atrás.
8. **Documentar:** actualizar evidencia, riesgos residuales, SHA del commit y pruebas realizadas.
9. **Integrar/desplegar:** solo después de revisión y aprobación; comprobar producción tras el despliegue y mantener plan de rollback.

## 6. Próximas acciones prioritarias

| Prioridad | Acción | Evidencia de cierre |
|---|---|---|
| P0 | Revisar PR #2 de sincronización | Node test en checkout limpio y POST/GET autenticado con revisión coincidente |
| P0 | Probar sincronización entre dos dispositivos | Cambio sintético visible en ambos; ninguna operación se pierde ni se duplica |
| P0 | Reconsultar Supabase | Versiones activas, estado de `app_state` y reconciliación de operaciones históricas documentados |
| P1 | Revisar PR #3 del texto `⚠️GUARDAR⚠️` | Test Node ejecutado y prueba visual de las tres acciones |
| P1 | Matriz de estados de partes/avisos | Capturas o pruebas automatizadas por estado y acciones permitidas |
| P1 | Revisar CORS/autorización de Edge Functions | Matriz de orígenes/sesiones con respuestas esperadas |
| P1 | Recibos y correo idempotentes | Pruebas de datos erróneos, timeouts y reintentos |
| P2 | Corregir rutas de `DEPLOY.md` | Comandos probados en checkout limpio |
| P2 | Pruebas PWA/biometría/offline | Casos online/offline y actualización de caché aprobados |

## 7. Referencias del repositorio

- [PR #2 — sincronización](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2)
- [PR #3 — etiqueta de guardado](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/3)
- [Informe de hallazgos de la iteración 7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/blob/main/ITERACION-7-HALLAZGOS.md)
- [Candidatos de reparación](https://github.com/sintergiase-lgtm/SintergiaSE-APP/blob/main/README-SintergiaSE-reparaciones-candidatas.md)
- [Auditoría incremental del 9 de octubre](https://github.com/sintergiase-lgtm/SintergiaSE-APP/blob/main/SintergiaSE-auditoria-2026-10-09.md)
- [Guía de despliegue](https://github.com/sintergiase-lgtm/SintergiaSE-APP/blob/main/DEPLOY.md)

**Criterio de finalización:** ninguna reparación se considera cerrada hasta que la prueba que reproduce el fallo pase después del cambio, se compruebe el comportamiento real cuando afecta a producción y queden documentados los riesgos que sigan abiertos.
