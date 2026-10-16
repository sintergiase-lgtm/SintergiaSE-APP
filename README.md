# SintergiaSE — Static Web

Frontend estático; Cloudflare Pages es el alojamiento canónico y operativo.

Backend: Supabase.

## Restricción de coste: 0 €

La aplicación debe funcionar sin cargos de plataformas. No crearé recursos remotos que puedan facturarse, ni activaré proveedores de pago.

- **QA:** no crear ramas de Supabase. Supabase factura el cómputo de las ramas de vista previa por hora ([detalle oficial](https://supabase.com/docs/guides/platform/manage-your-usage/branching)). La alternativa prevista es una instancia local/efímera en CI.
- **CI:** este repositorio es público; GitHub indica que los runners estándar de Actions son gratuitos para repositorios públicos ([facturación oficial](https://docs.github.com/en/actions/concepts/billing-and-usage)).
- **Frontend:** Cloudflare Pages publica desde `main` en [https://sintergiase-app.pages.dev](https://sintergiase-app.pages.dev); el build reduce el HTML a 2.872.191 bytes y entrega HSTS, `nosniff` y `X-Frame-Options`. La PR #17 integrada contiene la optimización. La URL de GitHub Pages ahora publica solo una redirección a Cloudflare, con CSP meta y un service worker de migración que elimina el caché legado y redirige las sesiones abiertas. Cloudflare sigue siendo la URL operativa y el único origen de la aplicación. GitHub Pages también tiene restricciones para sitios comerciales/SaaS ([límites y términos](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
- **Supabase existente:** la organización conectada está en plan **Free** (verificado el 16-10-2026); el proyecto de producción está activo. Las cuotas publicadas incluyen 500.000 invocaciones Edge/mes, 500 MB de base de datos, 5 GB de egress y 1 GB de Storage. Esta conexión no expone el consumo restante, por lo que no se da por garantizado el margen de cuota ([cuotas oficiales](https://supabase.com/docs/guides/platform/billing-on-supabase)).
- **Servicios externos:** IA, mapas, correo y mensajería pueden consumir cuotas o claves con coste. No deben habilitarse con claves de pago para cumplir el objetivo de 0 €; los límites gratuitos no garantizan disponibilidad continua.

La URL pública observada el 16-10-2026 es [https://sintergiase-lgtm.github.io/SintergiaSE-APP/](https://sintergiase-lgtm.github.io/SintergiaSE-APP/). La página cargó, el indicador de Supabase apareció operativo y no se observaron errores de consola. El formulario visible rechazó la credencial de la sesión de prueba; no se alcanzó el paso de identidad ni se hicieron escrituras. Después apareció una vista local en modo administrador con firma y jornada previas; no se atribuye a la autenticación recién probada. La firma técnica quedó pendiente, por lo que no se recorrieron los módulos de trabajo. La URL no está confirmada como QA ni se verificó que sirva el commit fusionado.

## Estado de revisión de la aplicación — 16 de octubre de 2026

La PR #2 se fusionó en `main` con el commit `69057254b65165d654d5608ec34b59c60d3d1122`; su round-trip virtual está aprobado en CI. El despliegue de ese commit no está confirmado. Las demás PR quedan en revisión según sus estados individuales.

### Reparaciones preparadas

- **Cuerpos JSON acotados en backend — [PR #21](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/21)**, abierta y pendiente de revisión: un lector común para `sync-operations` y `realtime-snapshot` valida `Content-Length`, limita los bytes realmente leídos, cancela excesos y rechaza UTF-8/JSON inválido. La regresión sintética Node 20 y los seis checks de CI, incluido Supabase local efímero, pasaron en [la ejecución](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38848998216). Las Edge Functions no se han desplegado en producción.

- **Sincronización P0 — [PR #2](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2)**, fusionada en `main` mediante `69057254b65165d654d5608ec34b59c60d3d1122`. Ante 401/403 conserva la operación y la cola pendiente, detiene reintentos hasta reautenticar y los POST diferidos usan la sesión actual. La rama está reconciliada con `main`; el código `42ee856399fd2bb04b68fb862f8beb1d275f7861` pasa regresiones y el round-trip de dos dispositivos virtuales pasa contra Supabase local aislado (CI del head de PR `ec89867795078bc4e9517306e8cff3b13452bb1c`).
- **Fallback de snapshots — [PR #6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6)**, abierta, en borrador y mergeable. Encola un snapshot completo antes de retirar operaciones pendientes y conserva las operaciones si no puede confirmarse.
- **Tombstones y conflictos — [PR #7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7)**, abierta, en borrador y mergeable. Conserva eliminaciones y conflictos sin resolver, y verifica la persistencia antes de aplicar snapshots.
- **Identidad y firma — [PR #13](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13)**, abierta, en borrador y mergeable; hace explícito que la validación de DNI no acredita identidad real y exige persistir una firma antes de iniciar jornada.
- **Recibos y copias — [PR #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14)**, abierta, en borrador y mergeable. Verifica usando el importe registrado, guarda el archivo en Storage y conserva su referencia/hash. El guardado multiclave de `localStorage` intenta restaurar los valores anteriores si una escritura falla; sigue sin ser transaccional ni cifrado.

### Validación automatizada

Los workflows de GitHub Actions terminaron correctamente en los heads indicados:

- PR #2: [Sync P0 y round-trip sintético](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38822273686) y [regresiones cliente/recibos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38822273884), aprobados. El job de integración se ejecutó sobre el merge ref de PR cuyo head era `ec89867795078bc4e9517306e8cff3b13452bb1c`; ambos contextos usaron las funciones reales `postSnapshot`/`obtenerRemoto`, HTTP autenticado y el Edge Function y PostgreSQL de Supabase local efímero.
- PR #6: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6/checks) (sincronización).
- PR #7: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7/checks) (sincronización).
- PR #13: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13/checks) (identidad y firma).
- PR #14: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14/checks) (verificación de recibos).

Las suites automatizadas se ejecutaron después de reconciliar con `main`. La prueba de #2 levanta Supabase local efímero, verifica POST/GET autenticados y bidireccionales desde dos contextos de dispositivo independientes, y compara `sourceId`/`revision` exactos. Ejecuta el código real del cliente contra el Edge Function y PostgreSQL reales del stack local; no usa mocks ni toca producción. Es una validación virtual de integración, no una prueba con teléfonos físicos.

### Proceso de reparación — punto actual: auditoría de APIs gratuitas y optimización estática preparada; publicación persistente pendiente; contraseña preservada

1. **Análisis y regresiones de cliente:** completados para la PR #2.
2. **Integración sintética aislada:** completada. Se corrigió el orden de arranque del Edge Runtime para que use la URL de la base local, el bind JSON de la fixture QA y la unión de tombstones necesaria al actualizar un snapshot existente. El workflow pasó; no se usó el Supabase conectado a producción.
3. **Validación virtual en dos dispositivos:** completada en CI. Dos contextos independientes recorrieron el flujo real del cliente con sesiones sintéticas y Supabase local efímero: A escribió y leyó; B leyó el snapshot de A y guardó una revisión nueva; A recibió exactamente el `sourceId`/`revision` de B. No se usaron teléfonos físicos ni la instancia de producción.
4. **Comprobación funcional de navegador (16-10-2026):** shell cargó sin errores visibles de consola; se recorrieron los 18 módulos del panel en modo de solo lectura. El indicador de Supabase estuvo operativo y el reloj avanzó. No se guardaron partes ni se aceptaron firmas. El intento de acceso previo fue rechazado; la vista administrativa provenía de estado local persistido y no valida un inicio de sesión nuevo. Antes de conectar Cloudflare y de integrar la PR #17, la URL pública con y sin parámetro anti-caché aún entregó HTML antiguo; el despliegue de ese commit no estaba confirmado. Esta condición quedó resuelta después de integrar la PR #17; la comprobación actual se registra en el punto 6.
5. **Seguridad de acceso — corrección fusionada (16-10-2026):** la [PR #16](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/16) (`fix/public-auth-credential-leak-20261016`) se fusionó en `main` con el commit `0697d53b80f471479dda34f891462775a305ef24`. El cambio elimina del HTML público la referencia a la credencial y el fallback local legado inalcanzable; añade una regresión que comprueba ambas condiciones y compila los 46 scripts inline (0 errores sintácticos). Pasaron la [guardia de acceso](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395723), las [regresiones de cliente y recibos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395729) y la [suite sync P0 con round-trip virtual de dos dispositivos en Supabase local](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395685). La URL pública todavía sirve la versión anterior, así que la publicación del cambio sigue sin verificarse. Por instrucción del propietario, la contraseña actual se mantiene intacta: no se rotó ni se alteró la credencial. Este ciclo no ha escrito en producción.

6. **Publicación temporal en Cloud Shell (16-10-2026):** se clonó y sincronizó la rama `main` en Cloud Shell; el código de aplicación servido corresponde al cambio funcional de `0697d53b80f471479dda34f891462775a305ef24` (los commits posteriores de `main` en esta secuencia solo actualizan documentación), y se sirvió el frontend con el Web Preview del puerto 8080. La guardia `node test-public-auth-guard.cjs` pasó (46 scripts inline, sin errores sintácticos); la pantalla de acceso mostró validación contra el backend y no el fallback local eliminado. Es una vista previa real del HTML actual, pero el proceso de Cloud Shell se apaga al terminar la sesión y no constituye hosting persistente. No se creó ningún recurso de GCP/Firebase. Después se creó el proyecto persistente de Cloudflare Pages `sintergiase-app`, conectado a `main`; el build de producción está aprobado. Tras integrar la PR #17, una recarga de ambas URLs públicas, con y sin parámetro anti-caché, mostró la landing y el acceso validado por backend.

#### Protocolo adicional en dispositivos físicos (si se requiere validar hardware)

- Preparar una URL QA de coste cero que sirva exactamente el commit evaluado y apunte a un proyecto/datos sintéticos aislados. Crear dos sesiones de prueba independientes; no usar cuentas ni datos operativos.
- Abrir esa misma versión en los dispositivos A y B. Registrar commit, modelo, sistema operativo, navegador y hora UTC de inicio.
- En A, crear un registro sintético y esperar confirmación remota. Anotar `sourceId` y `revision`; en B, recargar y comprobar que llegan los mismos valores y el registro completo.
- En B, guardar una revisión nueva y confirmar en A que se recibe esa revisión exacta una sola vez.
- Desconectar A, crear otro cambio, cerrar y reabrir la app; comprobar que permanece en la cola local. Reconectar y verificar confirmación y lectura desde B, sin duplicados ni pérdida.
- Eliminar en B un registro sintético; confirmar que el tombstone se conserva y que el registro no reaparece al reiniciar o resincronizar A.
- Guardar evidencias sin credenciales ni datos personales: commit, resultados por paso, IDs sintéticos, revisiones, estado de cola y errores de consola/red saneados.

**Cierre de esta validación:** el round-trip virtual quedó aprobado en CI contra un stack efímero. Si el proceso de publicación exige evidencia de hardware, ejecutar además los pasos anteriores en dos dispositivos contra QA aislado; la prueba física continúa pendiente y no se declara como realizada. No escribir en producción ni desplegar la rama durante esa prueba.

### Estado de backend y límites conocidos

- Auditoría de funciones activas (sin leer valores de secretos): OpenAI se llama desde IA/normativa/recibos; Google Routes puede usarse si hay una clave configurada; correo y WhatsApp pueden pasar por Resend y Twilio. Esos proveedores pueden generar cargos. No se puede garantizar 0 € hasta desactivar las rutas de pago o sustituirlas por alternativas con límites de coste verificados.
- El plan de facturación y el uso restante del proyecto Supabase conectado no están disponibles mediante esta conexión. El nivel gratuito tiene cuotas y la superación puede restringir el servicio; no se debe asumir que el proyecto esté en Free.
- El proyecto Supabase de producción conserva sus credenciales y datos; las comprobaciones allí fueron sin sesión y de solo lectura. Para este trabajo se usó el proyecto QA existente con identidades y snapshots sintéticos, y al terminar se borraron sus claves, credenciales e historial de pruebas. El cambio CORS anterior sigue en `authenticate` v16; las funciones de sincronización están ahora en `realtime-snapshot` v19 y `sync-operations` v18.
- En el bucket privado `sintergia-docs`, el límite es 25 MiB y la allowlist actual no incluye `image/heic`. El cliente acepta HEIC; hay que decidir y validar el formato en un proyecto QA antes de alinear la configuración.
- Se observaron rechazos 401 y errores 503 en el endpoint de snapshots. La PR #2 corrige los reintentos ante 401/403, pero la causa de las sesiones rechazadas y de los 503 no quedó determinada.
- Las 14 tablas con RLS sin políticas no conceden privilegios de tabla ni uso del esquema `sintergia` a `anon` ni `authenticated`; el aviso actual es informativo y no justifica abrir políticas. Las funciones revisadas usan `verify_jwt=false`; autenticación y sincronización validan tokens HMAC propios. Falta probar los flujos autenticados completos en QA.
- Los datos operativos existentes siguen en texto claro en `localStorage`. Hace falta definir recuperación y ciclo de claves antes de planificar una migración de cifrado.
- La animación atómica independiente citada en el informe no está identificada como archivo independiente en la raíz. Su carga, visualización y rendimiento en navegador siguen sin verificar.

## Pendiente para cerrar la revisión

1. El backend autenticado ya pasó QA sintético contra el proyecto QA existente. Siguen pendientes un endpoint web QA aislado para validar el frontend completo y las pruebas físicas. Cloud Shell es una vista previa temporal, no un endpoint QA persistente. GitHub Pages ya solo redirige a Cloudflare y no debe usarse como entorno de QA.
2. La prueba física descrita arriba sigue pendiente si se requiere cobertura de hardware; la validación virtual solicitada ya está completada. Usar solo sesiones y datos sintéticos.
3. Probar desde navegador las funciones críticas, los flujos de ruta y geocodificación, normativa, gasolineras, diseño adaptable y animación; registrar errores de consola/red.
4. El round-trip autenticado POST/GET entre dos contextos virtuales pasó en CI para la PR #2. En hardware aún no se han reproducido desconexión/reinicio, reintento y tombstones; esta cobertura adicional queda condicionada a disponer de teléfonos y QA aislado.
5. **PR de reparación aún abiertas (16-10-2026):** las PR [#6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6), [#7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7), [#13](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13) y [#14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14) siguen en borrador. Sus suites de Actions pasan en los heads revisados: [sync #6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38525195831), [sync #7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38525203305), [identidad y firma #13](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38525207269), [recibos #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38525210113). Sus ramas, no obstante, están divergidas respecto a `main`: #6 (18 commits por delante/43 por detrás), #7 (42/43), #13 (13/66) y #14 (42/66). Reconciliar cada cambio sobre `main` y repetir CI antes de fusionar; los resultados actuales no validan esos cambios contra la versión vigente.
6. Desactivar o sustituir integraciones de IA, rutas, correo y mensajería que puedan generar cargos, con degradación clara si alcanzan cuotas gratuitas.
7. Acordar el diseño de gestión/recuperación de claves y la migración antes de cifrar datos existentes.

La PR #2 está fusionada en `main` en `69057254b65165d654d5608ec34b59c60d3d1122`; la PR #16 en `0697d53b80f471479dda34f891462775a305ef24`. El round-trip virtual de dos dispositivos pasa en CI con Supabase local efímero. Cloudflare Pages publica desde `main` en `https://sintergiase-app.pages.dev`; el workflow `Redirect legacy GitHub Pages URL` ya publica desde `pages-redirect/` y migra cachés del service worker antiguo; la prueba en navegador confirmó la redirección a Cloudflare. Cloud Shell es temporal. La contraseña de producción no se modificó.



### Endurecimiento aplicado — 16-10-2026

- Cloudflare Pages publica `_headers` con HSTS, `nosniff`, bloqueo de iframes, política de referrer y permisos del navegador limitados. El build copia el archivo y CI comprueba que llegue a `dist`.
- La CSP sigue en `Report-Only`. El build elimina los 46 bloques JavaScript inline y los convierte en 45 activos con hash, cargados en paralelo con `defer` y ejecutados en orden. La política de informe limita los elementos script al mismo origen. Aún quedan atributos de evento inline y HTML dinámico: no se activa una CSP de bloqueo hasta migrar y validar esos flujos.
- El smoke test [38839075158](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38839075158) comprobó por preflight los tres endpoints principales en producción: Cloudflare Pages está permitido, un origen no confiable queda rechazado y CORS con credenciales permanece desactivado.
- En Supabase, `authenticate` dejó de reflejar cualquier origen CORS; los tres endpoints principales de acceso/sincronización admiten explícitamente Cloudflare Pages y mantienen los orígenes HTTPS ya configurados. HMAC, sesiones, contraseñas y JWT personalizado no se modificaron.
- La aplicación cargó en Pages hasta la pantalla de acceso. No se introdujeron credenciales de producción ni se hicieron escrituras; por ello, autenticación real, módulos protegidos, sincronización y Storage aún requieren QA con una cuenta autorizada y datos sintéticos.

### Auditoría de APIs gratuitas y rendimiento — 16-10-2026

- Se revisaron las funciones Edge activas y los planes oficiales. La matriz de proveedores, límites y próximos cambios está en [docs/API_GRATUITAS_Y_COSTES.md](docs/API_GRATUITAS_Y_COSTES.md).
- **Coste:** el backend actual puede llamar a OpenAI, Google Routes, Twilio y Resend. Twilio cobra por mensaje; OpenAI/Google pueden facturarse por uso. El modo de coste cero no queda garantizado mientras esas rutas sigan habilitadas sin límite duro verificado. La ruta gratis de Open-Meteo es no comercial; BigDataCloud gratis no admite la llamada server-side actual con coordenadas. Nominatim requiere atribución, caché, máximo de 1 solicitud/segundo para toda la aplicación y no enviar direcciones personales.
- **Rendimiento:** `index.html` fuente medía 3.238.921 bytes; tras extraer solo los logotipos, el HTML público medía 2.872.191 bytes. La vista previa de la PR #19 lo reduce a 276.538 bytes (90,4 % menos que la versión pública previa) y separa 45 activos JavaScript con hash (2.599.297 bytes en total); los 45 responden 200 y reciben caché inmutable de un año. CI pasa el build, la guardia de acceso y la suite del service worker. Esta medición corresponde a la vista previa; la promoción a producción sigue pendiente.
- **Publicación:** la comprobación del 16-10-2026 confirma que Cloudflare Pages sirve la versión actual con cabeceras de seguridad. GitHub Pages publica únicamente la redirección hacia Cloudflare y no aloja el frontend. Cloud Shell es temporal. No se usaron credenciales reales de producción ni se escribieron datos.
- **Respaldo:** el ZIP histórico anterior a la PR #16 conserva código de autenticación legado. No restaurarlo ni redistribuirlo; el commit de Git debe usarse para rollback seguro hasta sustituir o retirar ese artefacto. La contraseña de producción se mantiene intacta.
- **Seguridad Supabase:** el advisor de seguridad informa 14 tablas de `sintergia` con RLS habilitado y sin políticas; los privilegios directos de `anon`/`authenticated` estaban restringidos en la revisión previa. El advisor de rendimiento señala 6 índices aún no usados. No se hicieron cambios de esquema en producción.

Siguiente ciclo: probar desde un endpoint web QA los módulos de negocio, Storage y proveedores externos; probar en dispositivos físicos; corregir los límites de coste de IA/mapas/mensajería; y decidir la recuperación de claves antes de cifrar datos existentes. No enviar datos reales de clientes a proveedores externos sin revisar privacidad y coste.


### Reparación de sincronización JSONB — 16-10-2026

- La causa del fallo de sincronización era el enlace de objetos JavaScript como texto JSON en consultas Postgres.js. Postgres almacenaba el texto como un escalar JSONB; la lectura y el reintento idempotente quedaban incompatibles. Las funciones ahora usan los enlaces JSON tipados de Postgres.js.
- Producción sirve `realtime-snapshot` v19 (`60cad40a5f1a`) y `sync-operations` v18 (`99336d7aa898`). El código de acceso sigue en `authenticate` v16; no se cambió la autenticación ni los secretos de producción.
- El proyecto Supabase QA existente se usó con cuentas y datos sintéticos. Pasaron login válido e inválido, CORS, rechazo de sesión ausente, snapshots independientes de dos sesiones, escritura, reintento idempotente y conflicto por reutilizar un identificador con otro contenido.
- En producción se limitaron las comprobaciones a salud, CORS y rechazo de solicitudes sin sesión. No se introdujeron credenciales, no se escribieron datos, no se cambiaron secretos ni se alteró el esquema de producción.
- El source de las tres funciones desplegadas y la regresión CI están añadidos en la PR de sincronización JSONB. La validación manual de los demás módulos, almacenamiento de documentos, proveedores externos y dispositivos físicos sigue pendiente.


## Punto de control y continuidad — 16-10-2026

### Estado exacto

- La PR [#19](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/19) está integrada en `main`. Commit desplegado: `0fd6cba5eb0236b14fff979c815317d0fa1567f0`.
- La URL operativa es [https://sintergiase-app.pages.dev](https://sintergiase-app.pages.dev). Después de la integración respondió HTTP 200. El HTML pasó de 2.872.191 a 276.538 bytes: una reducción del 90,4 % frente al build público anterior.
- El build transforma 46 bloques JavaScript inline en 45 activos con SHA-256. Los elementos usan `defer` para descargar en paralelo y conservar el orden. En la vista previa de la PR, los 45 activos respondieron HTTP 200; se sirven con caché inmutable de un año. El service worker está en versión v8.
- La interfaz de acceso se renderizó en la vista previa y comunica que la contraseña se valida en el backend. No se hizo un inicio de sesión con credenciales reales durante esta comprobación.
- GitHub Pages mantiene la redirección a Cloudflare y el worker de migración de caché legado. Cloudflare conserva HSTS, `nosniff`, bloqueo de iframes, política de referrer y permisos limitados.
- CI de la PR #19: pasaron Cloudflare Pages, build estático, regresiones de cliente, guardia de acceso y sync P0. El último estado observado del job `supabase-local-synthetic-roundtrip` seguía iniciando su stack Supabase local desechable; no registrarlo como aprobado en esta ejecución. La suite de round-trip sintético de dos dispositivos sí pasó en la integración anterior, PR #18.
- La CSP sigue en `Report-Only`. La política separa `script-src 'self'` y `script-src-elem 'self'`; `script-src-attr 'unsafe-inline'` continúa permitido en el informe. Los atributos de evento inline y el HTML que generan algunos módulos todavía deben migrarse antes de activar una CSP de bloqueo.
- La autenticación, el CORS y la sincronización del backend se repararon y probaron previamente con datos sintéticos en QA. Se eliminaron los datos de prueba. No se modificaron credenciales, secretos, esquema ni filas de producción.

### Trabajo pendiente, por prioridad

1. **Cerrar la verificación de CI:** consultar el resultado final de `supabase-local-synthetic-roundtrip` asociado a la PR #19. Si queda colgado o falla al iniciar Docker, distinguir un fallo de infraestructura de un fallo funcional y repetir solo esa prueba si es necesario.
2. **Separar QA de producción:** las vistas previas de Cloudflare usan el código cliente que apunta al proyecto Supabase de producción. Configurar un destino de backend de QA para vistas previas y confirmar que login, snapshots y sincronización de prueba nunca alcancen producción. No introducir contraseñas reales en una vista previa.
3. **Completar CSP:** eliminar manejadores `on*` del HTML estático y de plantillas creadas dinámicamente; reemplazarlos por listeners externos y acciones tipadas. Validar login, formularios, modales, informes, documentos, recibos y ventanas de impresión en vista previa. Mantener `Report-Only` hasta que no haya violaciones necesarias; después aplicar la política y volver a probar. No añadir `unsafe-eval`.
4. **Cifrar datos operativos locales:** clientes, partes, facturas, pendientes y existencias se guardan actualmente en almacenamiento del navegador sin cifrado en reposo. El PIN de bloqueo de sesión no cifra esos datos; las copias de seguridad cifradas no resuelven el almacenamiento diario. Diseñar una migración reversible, con recuperación y copia previa, y probarla primero con datos sintéticos en QA. No borrar ni transformar datos de usuarios reales sin verificar recuperación.
5. **Aplicar límites de coste en servidor:** definir cuotas por usuario/empresa y límites duros para IA, mapas, correo y mensajería. Mantener las claves solo en servidor, añadir idempotencia y controles de abuso, y dejar desactivadas las funciones de pago hasta confirmar cuotas y presupuesto. No presentar el servicio como gratuito continuo sin medirlo.
6. **Revisar las fronteras de Supabase:** el asesor de seguridad mostró 14 tablas del esquema privado `sintergia` con RLS activo y sin políticas. Verificar grants, exposición por API y acceso exclusivo por funciones de servidor; no añadir políticas abiertas para eliminar avisos informativos. Revisar también secretos, retención, límites de intentos y logs.
7. **Completar pruebas funcionales:** cubrir login y cierre de sesión, clientes, avisos, partes y firmas, facturas, almacén, horarios, recibos, copias cifradas, sincronización entre dos dispositivos y modo sin conexión. Probar hardware y biometría/WebAuthn en dispositivos reales cuando estén disponibles. Separar fallos de producto de límites del entorno.
8. **Después de cada cambio:** pasar CI, revisar la vista previa, comprobar cabeceras y recursos, hacer smoke de backend sin datos reales y documentar exactamente qué se probó. Promover a producción solo el commit probado y verificar el despliegue estable.

### Prompt mejorado para retomar

```text
Retoma el trabajo de SintergiaSE-APP leyendo este punto de control, el README completo, el estado actual de main y los checks/despliegues reales. Actúa con el rigor de un ingeniero senior de software y arquitecto de sistemas con más de 20 años de práctica: prioriza seguridad verificable, continuidad operativa, recuperación de datos y cambios pequeños que puedan probarse. Sé directo y avanza sin repetir explicaciones ni pedir permisos ya concedidos.

Objetivo: dejar la aplicación operativa y reducir sus riesgos hasta un nivel alto, sin afirmar que está terminada mientras haya comprobaciones o controles pendientes.

Orden de trabajo:
1. Resuelve el estado final del round-trip sintético de la PR #19 y confirma el commit y el despliegue que sirven en producción.
2. Separa los despliegues de vista previa del backend de producción. Usa el proyecto QA autorizado y únicamente datos sintéticos para probar login, sincronización y escrituras.
3. Migra manejadores inline estáticos y dinámicos, verifica todos los flujos afectados en preview y solo entonces aplica CSP de bloqueo sin unsafe-inline ni unsafe-eval.
4. Diseña e implementa cifrado en reposo para el almacenamiento local con migración compatible, recuperación probada y protección frente a pérdida de datos. Ensáyalo en QA antes de cualquier cambio operativo.
5. Añade límites duros en servidor para servicios que puedan consumir presupuesto; claves fuera del cliente y controles antiabuso.
6. Audita grants, RLS, funciones y exposición de Supabase. Mantén el acceso del cliente limitado a los contratos aprobados.
7. Ejecuta pruebas de extremo a extremo de todos los módulos y documenta las limitaciones físicas que no puedan reproducirse en el entorno.
8. Integra mediante PR, espera los checks pertinentes, valida la vista previa y comprueba el despliegue estable.

Límites:
- El repositorio autorizado es únicamente sintergiase-lgtm/SintergiaSE-APP.
- QA ya está autorizado para pruebas sintéticas. Producción se mantiene de solo lectura durante diagnóstico; no cambies credenciales, secretos, esquema ni datos de usuarios reales sin una autorización específica para ese cambio.
- No uses datos reales de clientes en pruebas, no pruebes credenciales reales en vistas previas y no publiques secretos en código, logs o README.
- No abras permisos CORS con comodín ni políticas RLS públicas para silenciar avisos.
- No declares una función segura, operativa o gratuita sin una prueba que lo demuestre.
- Si un check queda bloqueado por el entorno, registra el job, el último paso observado y la evidencia; continúa con tareas independientes y vuelve a probar cuando haya progreso.
- Mantén el README actualizado con el commit, los resultados reales, los riesgos abiertos y el siguiente paso. Al terminar cada tramo, informa brevemente qué cambió, qué pasó y qué sigue pendiente.
```
