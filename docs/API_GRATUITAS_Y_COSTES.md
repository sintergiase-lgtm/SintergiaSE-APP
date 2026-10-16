# APIs gratuitas: límites y estado operativo

**Revisión:** 16-10-2026 · **código auditado:** `main` en `4036044` · **coste objetivo:** 0 €.

## Estado actual

- La organización Supabase conectada está en plan **Free** y el proyecto de producción está activo. No se expone el consumo restante, así que no se certifica margen de cuota.
- Cuotas publicadas de Supabase Free: 500.000 invocaciones de Edge Functions al mes, 500 MB de base de datos por proyecto, 5 GB de egress, 1 GB de Storage y 2 millones de mensajes Realtime. En Free no hay sobreuso facturable, pero al llegar al límite puede dejar de funcionar o pausarse; el servicio puede pausar proyectos inactivos. [Precios y cuotas oficiales](https://supabase.com/docs/guides/platform/billing-on-supabase), [Edge Functions](https://supabase.com/docs/guides/functions/pricing).
- GitHub Pages todavía entrega HTML antiguo con marcadores del login local. Cloudflare Pages publica `https://sintergiase-app.pages.dev` desde `codex/free-tier-performance-20261016`; su build y despliegue terminaron correctamente. La página muestra acceso validado contra Supabase y ambos logos externalizados cargan. No se probó el inicio de sesión con la contraseña de producción.
- `index.html` pesa 3.238.921 bytes y contiene 46 scripts inline (2.600.069 bytes de JavaScript) y cuatro data URLs de imagen. Dos logotipos visibles suman más de 300 KB en base64. `scripts/build-static.mjs` genera una copia estática sin modificar el HTML fuente: externaliza esos logotipos como assets binarios con hash, conserva sin cambios sus bytes y copia los recursos PWA. La prueba verifica el acceso y la sintaxis de los 46 scripts.

## Matriz de servicios

| Función | Servicio observado | Evaluación de coste/uso | Decisión para 0 € |
|---|---|---|---|
| Datos de gasolineras | API pública del Ministerio de Energía | Fuente pública ya integrada. | Mantener; limitar consultas y cachear respuestas. |
| Geocodificación | Nominatim, Photon y Open-Meteo | Nominatim público requiere búsquedas bajo demanda, máximo 1 petición/segundo para toda la app, atribución, caché y no enviar datos personales/confidenciales. Open-Meteo Free es solo para uso no comercial y sin SLA. | No enviar direcciones de clientes a estos servicios sin una decisión de privacidad y consentimiento. Retirar Open-Meteo si el uso es comercial; cachear, espaciar y permitir cambiar proveedor. [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [Open-Meteo precios](https://open-meteo.com/en/pricing), [términos](https://open-meteo.com/en/terms). |
| Geocodificación inversa | Nominatim, Photon, ArcGIS, 3geonames y BigDataCloud | La ruta activa llama a BigDataCloud desde servidor. Su endpoint gratis sin clave es solo para llamadas desde el dispositivo del usuario con ubicación actual y consentimiento; no permite servidor ni coordenadas almacenadas/de terceros. | Eliminar esa alternativa server-side. Si la persona da permiso para usar ubicación actual, llamar desde el navegador; de lo contrario conservar el dato local o mostrar una ubicación aproximada. [Política del endpoint gratuito](https://www.bigdatacloud.com/docs/article/why-is-reverse-geocoding-api-free). |
| Rutas | OSRM público y Google Routes en la función `route` | OSRM demo es best effort, sin garantía de calidad y acceso revocable. Google Routes depende de clave y puede facturar. | Mantener cálculo local como fallback; no invocar Google en modo 0 €. Atribuir OSRM y no prometer SLA. [OSRM demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server). |
| IA, normativa y recibos | OpenAI API | Modelo seleccionado y API no garantizan coste cero; las llamadas de API se cobran por modelo/uso. Un límite de uso no es un presupuesto gratuito. | Deshabilitar llamada si no hay presupuesto duro y cuota confirmados; conservar mensaje claro y alternativa local. No enviar DNI, direcciones, facturas ni recibos a una API gratuita sin consentimiento y revisión de tratamiento. [Precios API](https://developers.openai.com/api/docs/pricing), [límites de gasto](https://developers.openai.com/api/docs/guides/rate-limits). |
| WhatsApp automático | Twilio WhatsApp | La tarifa publicada es 0,005 USD por mensaje más las tarifas de plantilla de Meta. | No usar desde el backend de 0 €. Alternativa sin cargo API: generar enlace `wa.me` y que la persona revise y envíe el mensaje manualmente. [Tarifas](https://www.twilio.com/en-us/whatsapp/pricing). |
| Correo | Gmail API / Resend | Resend publica Free con 3.000 mensajes/mes y 100/día; la cuenta debe permanecer en Free y el envío transmite los datos del destinatario. | Aplicar límites por día/mes, clave idempotente y bloqueo al alcanzar la cuota; no enviar en pruebas. [Resend](https://resend.com/pricing). |
| Hosting estático | Cloud Shell, GitHub Pages, Cloudflare Pages | Cloud Shell Web Preview no es persistente. GitHub Pages tiene restricciones para SaaS comercial. Cloudflare Pages Free está conectado a GitHub con despliegue automático desde la rama actual de la PR #17; no usa Pages Functions ni requiere claves de Cloudflare en el repositorio. El acceso de la app Cloudflare a GitHub está restringido a `SintergiaSE-APP`. | Usar `https://sintergiase-app.pages.dev` para la versión conectada. Tras integrar la PR #17, cambiar la rama de producción de Pages a `main`. La URL antigua de GitHub Pages permanece desactualizada. [Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). |

## Cambios reproducibles

Construir una copia de vista previa optimizada desde la raíz del repositorio:

```bash
node scripts/build-static.mjs /tmp/sintergia-static-build
python3 -m http.server 8080 --directory /tmp/sintergia-static-build
```

Validar el build y los 46 scripts inline:

```bash
node test-static-image-build.cjs
node test-public-auth-guard.cjs
```

El build separa solo imágenes grandes usadas directamente en `<img src="data:image/...">`; conserva la imagen corporativa embebida que se usa en la generación de documentos. No modifica autentificación, datos de producción ni llamadas de API. La salida de build es una vista previa y requiere publicación explícita para volverse persistente.

## Próximo ciclo

1. Tras integrar la PR #17, cambiar la rama de producción del proyecto Cloudflare Pages de `codex/free-tier-performance-20261016` a `main` y verificar el despliegue resultante; no publicar el ZIP histórico con el login local heredado.
2. Hosting persistente ya conectado en Cloudflare Pages; comprobar la URL estable en las revisiones futuras y mantener la compilación optimizada.
3. Añadir caché/limitador global a geocodificación; eliminar Open-Meteo y BigDataCloud server-side de las rutas comerciales.
4. Poner OpenAI, Google Routes, Twilio y Resend detrás de límites duros o sustituirlos por alternativas de usuario iniciadas sin cargo API.
5. Ejecutar ronda de navegador y round-trip sintético contra stack efímero; no tocar datos de producción.
