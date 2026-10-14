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

La configuración del repositorio no acredita por sí sola que exista un despliegue público activo. Falta anotar y probar la URL real del sitio.

## Estado de revisión de la aplicación — 14 de octubre de 2026

Las cinco PR están abiertas; #2 no está en borrador y #6/#7/#13/#14 sí. Esta nota registra las reconciliaciones y el CI posterior contra `main`; ninguna PR está fusionada ni desplegada.

### Reparaciones preparadas

- **Sincronización P0 — [PR #2](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2)**, abierta y mergeable. Ante 401/403 se conserva la operación y la cola pendiente y se detienen los reintentos automáticos hasta reautenticar. Los POST diferidos usan la sesión actual. La rama se reconcilió con `main`.
- **Fallback de snapshots — [PR #6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6)**, abierta, en borrador y mergeable. Encola un snapshot completo antes de retirar operaciones pendientes y conserva las operaciones si no puede confirmarse.
- **Tombstones y conflictos — [PR #7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7)**, abierta, en borrador y mergeable. Conserva eliminaciones y conflictos sin resolver, y verifica la persistencia antes de aplicar snapshots.
- **Identidad y firma — [PR #13](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13)**, abierta, en borrador y mergeable; hace explícito que la validación de DNI no acredita identidad real y exige persistir una firma antes de iniciar jornada.
- **Recibos y copias — [PR #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14)**, abierta, en borrador y mergeable. Verifica usando el importe registrado, guarda el archivo en Storage y conserva su referencia/hash. El guardado multiclave de `localStorage` intenta restaurar los valores anteriores si una escritura falla; sigue sin ser transaccional ni cifrado.

### Validación automatizada

Los workflows de GitHub Actions terminaron correctamente en los heads indicados:

- PR #2: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2/checks) (sincronización y cliente/recibos).
- PR #6: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6/checks) (sincronización).
- PR #7: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7/checks) (sincronización).
- PR #13: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/13/checks) (identidad y firma).
- PR #14: [Checks](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14/checks) (verificación de recibos).

Las suites automatizadas se ejecutaron de nuevo tras la reconciliación con `main` y terminaron correctamente. Esto no sustituye una integración real con Supabase/Storage y dos dispositivos.

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

1. Preparar QA local/efímero con datos sintéticos y runners estándar gratuitos de GitHub Actions; no crear ramas Supabase facturables.
2. Configurar hosting estático gratuito dentro de cuotas y registrar su URL pública; aportar también el detalle de las dos advertencias actuales, sin tokens ni datos personales.
3. Probar desde navegador las funciones críticas, los flujos de ruta y geocodificación, normativa, gasolineras, diseño adaptable y animación; registrar errores de consola/red.
4. Ejecutar el round-trip autenticado y la prueba entre dos dispositivos, incluyendo desconexión, reinicio, reintentos, tombstones, conflictos y cuota local.
5. Reconciliación con `main` y CI completados para las PR #2, #6, #7, #13 y #14; falta completar revisión funcional antes de integrar.
6. Desactivar o sustituir integraciones de IA, rutas, correo y mensajería que puedan generar cargos, con degradación clara si alcanzan cuotas gratuitas.
7. Acordar el diseño de gestión/recuperación de claves y la migración antes de cifrar datos existentes.

No se han fusionado PR ni desplegado cambios de esta revisión. La aplicación no está certificada como publicada ni libre de errores hasta completar las pruebas con la URL y el entorno QA reales.
