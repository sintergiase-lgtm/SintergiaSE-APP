# SintergiaSE — Static Web

Frontend estático preparado para Cloudflare Pages o GitHub Pages.

Backend: Supabase.

## Restricción de coste: 0 €

La aplicación debe funcionar sin cargos de plataformas. No crearé recursos remotos que puedan facturarse, ni activaré proveedores de pago.

- **QA:** no crear ramas de Supabase. Supabase factura el cómputo de las ramas de vista previa por hora ([detalle oficial](https://supabase.com/docs/guides/platform/manage-your-usage/branching)). La alternativa prevista es una instancia local/efímera en CI.
- **CI:** este repositorio es público; GitHub indica que los runners estándar de Actions son gratuitos para repositorios públicos ([facturación oficial](https://docs.github.com/en/actions/concepts/billing-and-usage)).
- **Frontend:** Cloudflare Pages Free es una opción candidata para el HTML estático, dentro de sus límites publicados ([límites oficiales](https://developers.cloudflare.com/pages/platform/limits/)). No se ha creado ni configurado un despliegue. GitHub Pages tiene restricciones para sitios comerciales/SaaS ([límites y términos](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
- **Supabase existente:** la integración solo permite confirmar que el proyecto está activo; no expone aquí el plan de facturación ni el uso/cuotas. No se asume que sea gratis.
- **Servicios externos:** IA, mapas, correo y mensajería pueden consumir cuotas o claves con coste. No deben habilitarse con claves de pago para cumplir el objetivo de 0 €; los límites gratuitos no garantizan disponibilidad continua.

La URL pública observada el 16-10-2026 es [https://sintergiase-lgtm.github.io/SintergiaSE-APP/](https://sintergiase-lgtm.github.io/SintergiaSE-APP/). La página cargó, el indicador de Supabase apareció operativo y no se observaron errores de consola. El formulario visible rechazó la credencial de la sesión de prueba; no se alcanzó el paso de identidad ni se hicieron escrituras. Después apareció una vista local en modo administrador con firma y jornada previas; no se atribuye a la autenticación recién probada. La firma técnica quedó pendiente, por lo que no se recorrieron los módulos de trabajo. La URL no está confirmada como QA ni se verificó que sirva el commit fusionado.

## Estado de revisión de la aplicación — 16 de octubre de 2026

La PR #2 se fusionó en `main` con el commit `69057254b65165d654d5608ec34b59c60d3d1122`; su round-trip virtual está aprobado en CI. El despliegue de ese commit no está confirmado. Las demás PR quedan en revisión según sus estados individuales.

### Reparaciones preparadas

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

### Proceso de reparación — punto actual: corrección fusionada; publicación y rotación pendientes

1. **Análisis y regresiones de cliente:** completados para la PR #2.
2. **Integración sintética aislada:** completada. Se corrigió el orden de arranque del Edge Runtime para que use la URL de la base local, el bind JSON de la fixture QA y la unión de tombstones necesaria al actualizar un snapshot existente. El workflow pasó; no se usó el Supabase conectado a producción.
3. **Validación virtual en dos dispositivos:** completada en CI. Dos contextos independientes recorrieron el flujo real del cliente con sesiones sintéticas y Supabase local efímero: A escribió y leyó; B leyó el snapshot de A y guardó una revisión nueva; A recibió exactamente el `sourceId`/`revision` de B. No se usaron teléfonos físicos ni la instancia de producción.
4. **Comprobación funcional de navegador (16-10-2026):** shell cargó sin errores visibles de consola; se recorrieron los 18 módulos del panel en modo de solo lectura. El indicador de Supabase estuvo operativo y el reloj avanzó. No se guardaron partes ni se aceptaron firmas. El intento de acceso previo fue rechazado; la vista administrativa provenía de estado local persistido y no valida un inicio de sesión nuevo. Tras fusionar la PR #16, se recargó la URL pública con y sin parámetro anti-caché: ambas entregaron HTML antiguo. El despliegue del commit fusionado no está confirmado.
5. **Seguridad de acceso — corrección fusionada (16-10-2026):** la [PR #16](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/16) (`fix/public-auth-credential-leak-20261016`) se fusionó en `main` con el commit `0697d53b80f471479dda34f891462775a305ef24`. El cambio elimina del HTML público la referencia a la credencial y el fallback local legado inalcanzable; añade una regresión que comprueba ambas condiciones y compila los 46 scripts inline (0 errores sintácticos). Pasaron la [guardia de acceso](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395723), las [regresiones de cliente y recibos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395729) y la [suite sync P0 con round-trip virtual de dos dispositivos en Supabase local](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38828395685). La URL pública todavía sirve la versión anterior, así que la publicación del cambio sigue sin verificarse. La rotación de la credencial en Supabase de producción sigue pendiente antes de nuevas pruebas administrativas. Este ciclo no ha escrito en producción.

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
- Solo está conectado el proyecto Supabase de producción; no se usó para pruebas de escritura ni se modificaron funciones, datos, políticas, secretos o configuración.
- En el bucket privado `sintergia-docs`, el límite es 25 MiB y la allowlist actual no incluye `image/heic`. El cliente acepta HEIC; hay que decidir y validar el formato en un proyecto QA antes de alinear la configuración.
- Se observaron rechazos 401 y errores 503 en el endpoint de snapshots. La PR #2 corrige los reintentos ante 401/403, pero la causa de las sesiones rechazadas y de los 503 no quedó determinada.
- Las tablas señaladas por RLS sin políticas no conceden privilegios directos de tabla a `anon` ni `authenticated`. Las Edge Functions usan `verify_jwt=false`; la revisión estática encontró validación propia en rutas autenticadas, pero sus contratos requieren pruebas en QA.
- Los datos operativos existentes siguen en texto claro en `localStorage`. Hace falta definir recuperación y ciclo de claves antes de planificar una migración de cifrado.
- La animación atómica independiente citada en el informe no está identificada como archivo independiente en la raíz. Su carga, visualización y rendimiento en navegador siguen sin verificar.

## Pendiente para cerrar la revisión

1. Para una futura prueba física, preparar y registrar un endpoint QA aislado de coste cero que sirva el commit de `main` evaluado; la URL pública observada no está verificada como QA y aún sirve HTML anterior.
2. La prueba física descrita arriba sigue pendiente si se requiere cobertura de hardware; la validación virtual solicitada ya está completada. Usar solo sesiones y datos sintéticos.
3. Probar desde navegador las funciones críticas, los flujos de ruta y geocodificación, normativa, gasolineras, diseño adaptable y animación; registrar errores de consola/red.
4. El round-trip autenticado POST/GET entre dos contextos virtuales pasó en CI para la PR #2. En hardware aún no se han reproducido desconexión/reinicio, reintento y tombstones; esta cobertura adicional queda condicionada a disponer de teléfonos y QA aislado.
5. La PR #2 está fusionada en `main`; las PR #6, #7, #13 y #14 siguen pendientes de revisión funcional antes de integrar.
6. Desactivar o sustituir integraciones de IA, rutas, correo y mensajería que puedan generar cargos, con degradación clara si alcanzan cuotas gratuitas.
7. Acordar el diseño de gestión/recuperación de claves y la migración antes de cifrar datos existentes.

La PR #2 está fusionada en `main` en el commit `69057254b65165d654d5608ec34b59c60d3d1122`; la PR #16 también está fusionada en `main` (`0697d53b80f471479dda34f891462775a305ef24`). El round-trip virtual de dos dispositivos está aprobado en CI con Supabase local efímero. La URL pública no refleja todavía la corrección de la PR #16, por lo que no se declara desplegada. La rotación de la credencial de producción, la revisión global en un QA confirmado y cualquier certificación física siguen pendientes.
