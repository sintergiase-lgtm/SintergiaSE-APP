# SintergiaSE APP — correcciones detectadas en la auditoría

**Fecha:** 13-10-2026  
**Repositorio:** `sintergiase-lgtm/SintergiaSE-APP`  
**Rama revisada:** `main` · commit de referencia `53c14f72b439499470c7fd255e667cea70141ea8`  
**Backend:** Supabase, proyecto `bgjicsowspppsjzigazb`  
**Estado de esta revisión:** solo lectura. No se han modificado la aplicación, datos, funciones ni secretos de producción.

## Conclusión ejecutiva

La prioridad es demostrar la persistencia y sincronización real antes de tratar otros avisos como cerrados. La consulta a la base de datos encontró `sintergia.app_state` con **0 filas** y `sintergia.sync_operations` con **71 filas**. Las 71 filas aparecen como `applied`, pero sus campos `payload` y `result` son escalares JSONB de tipo `string`, no objetos; además, las 71 carecen de `actor_id`. Por tanto, el estado `applied` de esos registros históricos no demuestra que los cambios se guardaran.

La función activa `sync-operations` v15 rechaza operaciones incrementales que no soporta y fuerza el fallback a snapshot. El HTML tiene una ruta de fallback autenticada a `realtime-snapshot`, que llama a `touch_app_state_v18`; falta comprobar una escritura/lectura real de extremo a extremo, desde dos dispositivos. No se han borrado ni reetiquetado datos históricos.

## Hallazgos y reparaciones

### P0. Sincronización: persistencia real, no falsos acuses

**Evidencia:** 0 filas en `app_state`; 71 filas históricas `applied` con `payload/result` de tipo JSONB string y sin actor. El cliente admite el fallback de snapshot cuando el endpoint incremental devuelve 404/405.

**Corregir:** en un entorno aislado, crear un registro ficticio desde el dispositivo A, verificar respuesta y versión del servidor, leerlo desde el dispositivo B, modificarlo offline, reconectar y comprobar que no se pierde ni se duplica. Confirmar que una mutación no se quita de la cola hasta que el snapshot devuelve un acuse válido. No reproducir como éxito los 71 registros legacy ni alterarlos sin copia y reconciliación.

### P0. Merge de todas las colecciones y borrados

La función SQL `touch_app_state_v18` hace merge especial de `clientes`, `partes`, `facturas`, `pendientes`, `stock`, `stockListas` y `compras`, y tiene reglas para `tombstones` y `horario`. Las demás claves dependen de la fusión JSONB general; las colecciones como `avisos` y `rutas` pueden sobrescribirse con una copia antigua del snapshot.

**Corregir:** inventariar todos los campos de estado del HTML y definir merge/versionado para cada colección operativa, incluidos avisos y rutas. No basarse solo en relojes locales. Mantener tombstones durante el periodo que puedan quedar dispositivos offline. Probar escrituras simultáneas, cambios en campos distintos/iguales y borrados frente a snapshots antiguos.

### P1. Verificación de recibos debe fallar de forma segura

El código activo de `verify-receipt` v14 contiene una condición equivalente a `parsed.valido === true && parsed.referenciaCoincide !== false && parsed.importeCoincide !== false`. Si faltan las banderas de referencia o importe, no impide necesariamente aprobar el recibo. También procesa `req.json()` sin límite total antes del parseo.

**Corregir:** desplegar solo tras probar el candidato estricto: exigir las dos banderas exactamente `true`, referencia reconocida no vacía y coincidente, importe finito/no negativo coincidente con tolerancia de 0,01 €, imagen/MIME válidos y límites de cuerpo/Base64. Una salida malformada o una IA no disponible nunca debe devolver un recibo como válido. Probar referencias e importes erróneos, datos ausentes y payload excesivo.

### P1. Registro de recibos: token inmutable

La función activa `receipt-register` v13 usa `ON CONFLICT(token) DO UPDATE` para modificar la factura, importe y cliente asociados al token; también analiza JSON sin limitar previamente el cuerpo.

**Corregir:** mismo token y mismos datos = reintento idempotente; mismo token con datos distintos = HTTP 409 y ninguna reasignación. Validar longitudes/formato/importes y límites del cuerpo. Mantener estados separados: registrado no significa verificado.

### P1. CORS y sesión HMAC

Se identificó reflejo del origen solicitado en funciones como `verify-receipt`, `receipt-register` y `gasolineras`; otras funciones admiten cualquier origen cuando `ALLOWED_ORIGINS` está vacía. Varias Edge Functions están desplegadas con `verify_jwt=false`, lo que puede ser deliberado por usar sesiones HMAC propias `v1.<payload>.<signature>`, pero requiere verificación HMAC y autorización funcional en cada endpoint.

**Corregir:** una allowlist estricta de orígenes HTTPS confirmados, incluyendo `https://sintergiase-lgtm.github.io`; verificar preflight/POST con origen permitido y rechazado. No usar `*` ni reflejar cualquier origen. Diferenciar sesión inválida (401) de fallo de base de datos/secreto (503). No modificar biometría ni políticas RLS a ciegas.

### P1. Gmail y otros efectos externos: prevenir duplicados

Si Gmail acepta un correo pero falla después el registro en base de datos, el reintento puede enviarlo otra vez. Una transacción SQL local no revierte el envío externo.

**Corregir:** outbox transaccional con clave de idempotencia, estados `queued/sending/sent/unknown/failed` y reconciliación antes de reenviar en estado incierto. Confirmar configuración de Gmail y que no queda un fallback accidental a Resend si la migración a Gmail se considera terminada. Probar corte de red después de que el proveedor acepte, timeout y reintentos concurrentes.

### P1. Cuotas de IA/API

Validar la función `ai-gateway` realmente desplegada, no solo el candidato. Restringir modelos en servidor, tamaño de cuerpo/documentos, duración y frecuencia; aplicar cuota por sesión y límite diario de coste. Probar modelo no permitido, payload excesivo, timeout, 429 y 5xx.

### P2. Código local de autenticación obsoleto

En `index.html`, alrededor de la línea 4.078, `configurarLocal()` retorna `true` inmediatamente, antes de configurar contraseñas; `verificarLocal()` aún conserva el flujo heredado y claves sugeridas `SSE1`, `1111`, `2222`, `3333`. El punto de entrada `verificar()` actualmente delega en `verificarServidor()`; no se halló evidencia de que el login de producción use el flujo local.

**Corregir:** retirar el código muerto y claves/mensajes confusos después de pruebas de regresión. Mantener separadas la autenticación online y la apertura offline previamente autorizada. Una sesión `local-*` nunca debe autorizar operaciones remotas.

### P2. Biometría offline: preservar y verificar

Las funciones activas muestran `register-biometric` v20 y `authenticate-biometric` v19. `DEPLOY.md` indica que el acceso offline requiere verificar un permiso firmado, en contradicción con las pruebas/objetivo comunicados anteriormente.

**Corregir:** no cambiar las funciones biométricas durante la reparación del sync. Probar registro/login online, reinicio de la PWA en modo avión, caducidad del permiso y resincronización al reconectar. No considerar valores de `localStorage` prueba de identidad por sí solos.

### P2. Service worker, caché y arranque

`sw.js` utiliza la caché `sintergiase-shell-v6`; registra el service worker desde el HTML. Debe comprobarse que el shell y `offline-guard.js` se actualizan y que ningún token o respuesta de API entra en caché.

**Corregir:** aumentar la versión de caché al cambiar recursos del shell/guard; probar arranque limpio, actualización online, arranque offline y caché antigua. El guard inyectado por service worker no debe darse por activo en un HTML abierto como `file://`.

### P2. Animación y error antiguo de Three.js

El HTML conserva código/comentarios del sistema de átomos, órbitas, rayos y explosión. La búsqueda estática no encontró una URL literal `three.min.js` en el HTML activo, aunque sí un manejador antiguo que filtra ese error; no basta para afirmar que el fallo en runtime esté resuelto.

**Corregir:** desactivar únicamente la animación de átomos/explosión al entrar, conservar las animaciones de aceptación/check y observar la pestaña Network con caché limpia y PWA instalada. No ocultar errores reales con un filtro que no registre el componente. Si es un problema de caché, versionar el service worker en vez de reescribir el login.

### P2. Mapas offline

El módulo crea el botón “Mapa offline” en `#tab-rutas-ia .ria-actions` cuando no encuentra uno existente. La cobertura listada contiene ocho provincias andaluzas.

**Corregir/verificar:** botón dentro de Rutas IA en móvil/escritorio, sin duplicados; probar descargas incompletas, IndexedDB llena, falta de red y rutas fuera de cobertura. No etiquetar esa cobertura como mapa completo de España ni como tráfico en tiempo real.

### P3. RLS e índices

Security Advisor devuelve 14 avisos informativos `rls_enabled_no_policy`. La consulta de privilegios indica que `anon`, `authenticated` y `service_role` no tienen `USAGE` directo en el esquema `sintergia` en el momento de consulta. No crear políticas ni abrir el esquema automáticamente: revisar primero funciones `SECURITY DEFINER`, `search_path`, permisos EXECUTE, vistas y cada frontera de autorización. Seis índices figuran sin uso observado; no borrarlos sin medir carga representativa.

## Pruebas obligatorias antes de producción

- Sesión válida/errónea/caducada, 401/403/429/503 y fallo de secreto/base de datos.
- Snapshot write/read con autenticación real, versión creciente y lectura desde otro dispositivo.
- 20 dispositivos concurrentes: ediciones en el mismo/diferente campo, borrados, tombstones, desconexiones de días y reconexión con snapshot antiguo.
- Reintento idéntico y reutilización del mismo ID con contenido distinto.
- Cola local con almacenamiento casi lleno, cierre de pestaña durante sincronización y reinicio de PWA.
- Recibos con campos ausentes, referencia/importe incorrectos, imagen inválida y payload excesivo.
- Envíos Gmail duplicados/inciertos, límites IA y CORS desde orígenes permitidos/no permitidos.
- Biometría online/offline sin cambios en su implementación, caché vieja/nueva y animación de aceptación sin explosión de átomos.

## Orden de ejecución

1. Entorno aislado; escritura/lectura real de snapshot.
2. Merge concurrente de todas las colecciones y tombstones.
3. Recibos: verificación estricta y registro idempotente.
4. CORS y autenticación HMAC para todas las funciones activas.
5. Outbox Gmail e idempotencia de efectos externos; límites/cuotas de IA.
6. Limpieza del camino local obsoleto con pruebas de regresión.
7. Pruebas biométricas sin cambiar sus funciones, versión de caché y eliminación selectiva de la animación de átomos.
8. Simulación anual de 20 dispositivos; desplegar cada cambio de forma escalonada solo tras pasar las pruebas.

## Límites de la auditoría

Las consultas de datos/funciones fueron de solo lectura. Una consulta de detalle de logs falló con error interno del backend, y el HTML publicado no se pudo ejecutar desde el visor web utilizado. La inspección estática no equivale a una prueba de navegador/proveedor. No se declara producción libre de errores ni se han desplegado candidatos.

**Regla de cierre:** no marcar “sincronizado” sin persistencia verificada; no marcar recibo válido sin todas las comprobaciones; no reenviar un efecto externo en estado incierto sin reconciliar; no modificar el flujo biométrico sin pruebas específicas. Lovable no forma parte de la arquitectura revisada: frontend estático en GitHub Pages y backend Supabase.
