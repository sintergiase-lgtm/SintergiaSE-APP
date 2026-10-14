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

Esta actualización registra el estado de las ramas candidatas revisadas. Las PR indicadas siguen sin fusionar y sus cambios no se consideran desplegados en producción.

### Reparaciones preparadas

- **Sincronización P0 — [PR #2](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/2)**, head `8660aef062a2c7e09d41d66b327db34477a560ae`, abierta y mergeable. Ante 401/403 se conserva la operación y la cola pendiente y se detienen los reintentos automáticos hasta reautenticar. Los POST diferidos usan la sesión actual. La rama se reconcilió con `main`.
- **Fallback de snapshots — [PR #6](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/6)**, head `f35223ecb9e095cfdb82e9a9634ad48e4c075872`, abierta, en borrador y mergeable. Encola un snapshot completo antes de retirar operaciones pendientes y conserva las operaciones si no puede confirmarse.
- **Tombstones y conflictos — [PR #7](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/7)**, head `10248b98b986f044db40e7828bd9948bcd3b7928`, abierta, en borrador y mergeable. Conserva eliminaciones y conflictos sin resolver, y verifica la persistencia antes de aplicar snapshots.
- **Recibos y copias — [PR #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14)**, head `b44c070ac8088883c792ab8f9b4a517d638d335f`, abierta, en borrador y mergeable. Verifica usando el importe registrado, guarda el archivo en Storage y conserva su referencia/hash. El guardado multiclave de `localStorage` intenta restaurar los valores anteriores si una escritura falla; sigue sin ser transaccional ni cifrado.

### Validación automatizada

Los workflows de GitHub Actions terminaron correctamente en los heads indicados:

- PR #2: [regresión de sincronización — pull request](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38521912083), [push](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38521906081) y [recibos/copias del cliente](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38521912084).
- PR #6: [pull request](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38521919182) y [push](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38521912721).
- PR #7: [pull request](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38522029840) y [push](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38522025234).
- PR #14: [verificación de recibos](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38517102009) y [recibos/copias del cliente](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38517102055).

Esto acredita las suites automatizadas de esos workflows. No sustituye una prueba manual/local ni una integración real con Supabase, Storage y dos dispositivos.

### Estado de backend y límites conocidos

- Solo está conectado el proyecto Supabase de producción; no se usó para pruebas de escritura ni se modificaron funciones, datos, políticas, secretos o configuración.
- En el bucket privado `sintergia-docs`, el límite es 25 MiB y la allowlist actual no incluye `image/heic`. El cliente acepta HEIC; hay que decidir y validar el formato en un proyecto QA antes de alinear la configuración.
- Se observaron rechazos 401 y errores 503 en el endpoint de snapshots. La PR #2 corrige los reintentos ante 401/403, pero la causa de las sesiones rechazadas y de los 503 no quedó determinada.
- Las tablas señaladas por RLS sin políticas no conceden privilegios directos de tabla a `anon` ni `authenticated`. Las Edge Functions usan `verify_jwt=false`; la revisión estática encontró validación propia en rutas autenticadas, pero sus contratos requieren pruebas en QA.
- Los datos operativos existentes siguen en texto claro en `localStorage`. Hace falta definir recuperación y ciclo de claves antes de planificar una migración de cifrado.
- La animación atómica independiente citada en el informe no está identificada como archivo independiente en la raíz. Su carga, visualización y rendimiento en navegador siguen sin verificar.

## Pendiente para cerrar la revisión

1. Preparar QA sin costes mediante Supabase local/CI y datos sintéticos; no usar ramas de vista previa facturables.
2. Configurar un hosting dentro del plan gratuito y registrar su URL pública; aportar también el detalle de las dos advertencias actuales, sin tokens ni datos personales.
3. Probar desde navegador las funciones críticas, los flujos de ruta y geocodificación, normativa, gasolineras, diseño adaptable y animación; registrar errores de consola/red.
4. Ejecutar el round-trip autenticado y la prueba entre dos dispositivos, incluyendo desconexión, reinicio, reintentos, tombstones, conflictos y cuota local.
5. Revisar e integrar las PR en orden: #2, #6 y #7; revisar por separado #14 antes de cualquier despliegue.
6. Acordar el diseño de gestión/recuperación de claves y la migración antes de cifrar datos existentes.

No se han fusionado PR ni desplegado cambios de esta revisión. La aplicación no está certificada como publicada ni libre de errores hasta completar las pruebas con la URL y el entorno QA reales.
