# SintergiaSE — Static Web

Frontend estático preparado para Cloudflare Pages o GitHub Pages.

Backend: Supabase.

## Cloudflare Pages
- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `.`

## GitHub Pages
- Publicar desde `main` / root
- `.nojekyll` included

## Estado de reparación y progreso — 14 de octubre de 2026

### Corregido y validado en el cliente
- La carga de recibos admite únicamente JPEG, PNG, WEBP, HEIC y PDF; normaliza el MIME por extensión cuando el navegador no lo proporciona y rechaza otros tipos.
- Al rechazar un recibo se recupera el estado anterior no terminal de la factura. La aprobación manual limpia marcas de rechazo obsoletas.
- La importación de copia cifrada informa que fusiona datos, toma la revisión y el dispositivo actuales, conserva los registros locales más recientes o ausentes en la copia y no anuncia éxito si falla el guardado.
- El aplicador de snapshots propaga errores de persistencia. La resolución local de conflictos y la sincronización periódica respetan el resultado y permiten reintentar después de un fallo.

### A medias y sin validar contra servicios reales
- `localStorage` guarda varias claves por separado. Ahora se informa del fallo, pero una cuota agotada aún puede dejar algunas claves escritas; falta una estrategia transaccional y recuperable.
- La importación del backup es una fusión según las reglas de sincronización, no una restauración exacta: conserva registros locales más recientes y los que no aparezcan en la copia.
- La verificación de recibos con Supabase Storage sigue como candidata en [PR #14](https://github.com/sintergiase-lgtm/SintergiaSE-APP/pull/14). El bucket `sintergia-docs`, sus políticas, la tabla de metadatos y la recuperación real del archivo requieren QA en un proyecto de pruebas. No se consideran desplegados.
- Las pruebas ejecutadas son regresiones automatizadas con datos sintéticos. Falta QA visual en navegador e integración autenticada de extremo a extremo.

### Por hacer
1. En Supabase de pruebas, validar carga, lectura, reemplazo, reintentos, errores compensatorios y permisos privados de Storage para JPEG, PNG, WEBP, HEIC y PDF.
2. Probar sincronización autenticada entre dos dispositivos, incluidos modo offline, reinicio, reintentos, tombstones, conflictos y cuota local.
3. Completar la matriz funcional y visual de avisos, partes, facturas, recibos, correo/citas, biometría y acceso offline.
4. Revisar e integrar en orden los candidatos pendientes de sincronización y acciones de interfaz; confirmar versiones activas y esquema antes de cualquier despliegue.
5. Revisar privacidad y recuperación: los datos activos de clientes, partes y facturas permanecen en texto claro en `localStorage`; definir ciclo de claves y migración antes de cifrar ese almacenamiento.
6. Comparar el contenido de `main` con la URL y el artefacto realmente publicados. No se ha certificado que producción esté libre de errores.

### Validación de cliente
Las regresiones ejecutan ambos HTML completos con datos sintéticos:

- `node test-client-receipt-state.cjs`: 16 rechazos y 2 aprobaciones manuales en las dos páginas.
- `node test-encrypted-backup-merge.cjs`: importación por fusión, resultado durable y manejo del fallo de persistencia.
- El workflow [Client receipt and backup regression tests](.github/workflows/client-receipt-backup-regression.yml) repite estas suites en Node 20.
