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

La URL pública observada el 16-10-2026 es [https://sintergiase-lgtm.github.io/SintergiaSE-APP/](https://sintergiase-lgtm.github.io/SintergiaSE-APP/); muestra la portada y la puerta de acceso por contraseña. No se autenticó ni se hicieron escrituras. No se ha confirmado que sirva el commit de la PR #2 ni que sea un entorno QA, así que no aporta evidencia de la reparación.

## Estado de revisión de la aplicación — 16 de octubre de 2026

Hay 13 PR abiertas: la #2 está fuera de borrador y las otras 12 siguen en borrador. Esta nota registra el estado de la reparación P0 de sincronización en la PR #2; las PR siguen sin fusionar ni desplegar.

### Reparaciones preparadas

- **Sincronización P0 — [PR #2](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2)**, abierta, fuera de borrador y mergeable. Ante 401/403 conserva la operación y la cola pendiente, detiene reintentos hasta reautenticar y los POST diferidos usan la sesión actual. La rama está reconciliada con `main`; el head `42ee856399fd2bb04b68fb862f8beb1d275f7861` pasa CI. El round-trip sintético autenticado entre dos contextos de dispositivo también pasa.
- **Fallback de snapshots — [PR #6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6)**, abierta, en borrador y mergeable. Encola un snapshot completo antes de retirar operaciones pendientes y conserva las operaciones si no puede confirmarse.
- **Tombstones y conflictos — [PR #7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7)**, abierta, en borrador y mergeable. Conserva eliminaciones y conflictos sin resolver, y verifica la persistencia antes de aplicar snapshots.
- **Identidad y firma — [PR #13](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13)**, abierta, en borrador y mergeable; hace explícito que la validación de DNI no acredita identidad real y exige persistir una firma antes de iniciar jornada.
- **Recibos y copias — [PR #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14)**, abierta, en borrador y mergeable. Verifica usando el importe registrado, guarda el archivo en Storage y conserva su referencia/hash. El guardado multiclave de `localStorage` intenta restaurar los valores anteriores si una escritura falla; sigue sin ser transaccional ni cifrado.

### Validación automatizada

Los workflows de GitHub Actions terminaron correctamente en los heads indicados:

- PR #2: [Sync P0 y round-trip sintético](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38820719672) y [regresiones cliente/recibos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38820719646), aprobados en el head `42ee856399fd2bb04b68fb862f8beb1d275f7861`.
- PR #6: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6/checks) (sincronización).
- PR #7: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7/checks) (sincronización).
- PR #13: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13/checks) (identidad y firma).
- PR #14: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14/checks) (verificación de recibos).

Las suites automatizadas se ejecutaron después de reconciliar con `main`. La prueba de #2 levanta Supabase local efímero, verifica POST/GET autenticados desde dos contextos independientes y compara `sourceId`/`revision` exactos. Esto valida el flujo sintético; no acredita una prueba física en dos dispositivos.

### Proceso de reparación — punto actual

1. **Análisis y regresiones de cliente:** completados para la PR #2.
2. **Integración sintética aislada:** completada. Se corrigió el orden de arranque del Edge Runtime para que use la URL de la base local, el bind JSON de la fixture QA y la unión de tombstones necesaria al actualizar un snapshot existente. El workflow pasó; no se usó el Supabase conectado a producción.
3. **Validación física en dos dispositivos:** pendiente. La sesión no expone teléfonos físicos conectados. La URL pública indicada arriba presenta acceso, pero no está confirmada como QA ni como el head de la PR; no se debe usar para probar escrituras de esta reparación.

#### Procedimiento para completar la validación física

- Preparar una URL QA de coste cero que sirva exactamente el commit evaluado y apunte a un proyecto/datos sintéticos aislados. Crear dos sesiones de prueba independientes; no usar cuentas ni datos operativos.
- Abrir esa misma versión en los dispositivos A y B. Registrar commit, modelo, sistema operativo, navegador y hora UTC de inicio.
- En A, crear un registro sintético y esperar confirmación remota. Anotar `sourceId` y `revision`; en B, recargar y comprobar que llegan los mismos valores y el registro completo.
- En B, guardar una revisión nueva y confirmar en A que se recibe esa revisión exacta una sola vez.
- Desconectar A, crear otro cambio, cerrar y reabrir la app; comprobar que permanece en la cola local. Reconectar y verificar confirmación y lectura desde B, sin duplicados ni pérdida.
- Eliminar en B un registro sintético; confirmar que el tombstone se conserva y que el registro no reaparece al reiniciar o resincronizar A.
- Guardar evidencias sin credenciales ni datos personales: commit, resultados por paso, IDs sintéticos, revisiones, estado de cola y errores de consola/red saneados.

**Criterio de cierre:** los pasos deben pasar en los dos dispositivos contra QA aislado y quedar registrados antes de integrar la PR. No escribir en producción ni desplegar la rama sin completar este control.

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

1. Preparar y registrar un endpoint QA aislado de coste cero que sirva el head de la PR #2; la URL pública observada no está verificada como QA.
2. Completar y documentar la prueba física de dos dispositivos descrita arriba; usar solo sesiones y datos sintéticos, sin tokens ni información personal.
3. Probar desde navegador las funciones críticas, los flujos de ruta y geocodificación, normativa, gasolineras, diseño adaptable y animación; registrar errores de consola/red.
4. La prueba autenticada POST/GET y el round-trip sintético en CI están completados para la PR #2. Falta reproducir en dispositivos físicos la cola durante desconexión/reinicio, el reintento, la revisión exacta y la eliminación por tombstone.
5. Reconciliación con `main` y CI completados para las PR #2, #6, #7, #13 y #14; falta completar revisión funcional antes de integrar.
6. Desactivar o sustituir integraciones de IA, rutas, correo y mensajería que puedan generar cargos, con degradación clara si alcanzan cuotas gratuitas.
7. Acordar el diseño de gestión/recuperación de claves y la migración antes de cifrar datos existentes.

No se han fusionado PR ni desplegado cambios de esta revisión. La aplicación no está certificada como publicada ni libre de errores hasta completar las pruebas con la URL y el entorno QA reales.
