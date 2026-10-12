# SintergiaSE — Iteración 7: guardia offline y estado real de sincronización

**Fecha:** 12 de octubre de 2026  
**Repositorio inspeccionado:** `sintergiase-lgtm/SintergiaSE-APP`, rama `main` (solo lectura).  
**Proyecto Supabase:** `bgjicsowspppsjzigazb`.  
**Estado:** parche candidato preparado como ZIP; no desplegado ni aplicado a GitHub/Supabase.

## 1. Hallazgo nuevo: inyección defectuosa de la guardia offline

En el `sw.js` inspeccionado en `main`, la constante `GUARD_TAG` contiene dos barras invertidas antes de `/script`. Debido a cómo se interpreta una cadena JavaScript, queda una barra invertida en el HTML resultante (`<\\/script>` en lugar de `</script>`). El parser HTML no interpreta eso como el cierre normal del elemento `script`. La guardia `offline-guard.js` podría no instalarse correctamente cuando el service worker modifica el documento. Esto no demuestra por sí solo un bypass completo, pero sí invalida la garantía de que la guardia se carga por esa inyección.

### Reparación candidata incluida

- `sw.js`: genera un cierre literal `</script>`.
- Incrementa el nombre de caché de `v5` a `v6` para que el navegador sustituya la shell previa.
- Mantiene API, sincronización y autenticación fuera de la interceptación de caché.
- `test-sw-guard.cjs`: comprueba la etiqueta, la versión de caché y el bypass de API/auth.

**Efecto de caché:** al activar la nueva versión, se eliminan cachés anteriores con prefijo `sintergiase-shell-`. El cambio no borra `localStorage` ni `IndexedDB`, pero debe verificarse el arranque offline en un dispositivo de prueba.

## 2. Consulta de solo lectura del backend actual

La consulta ejecutada sobre el proyecto actual devolvió:

| Comprobación | Resultado |
|---|---:|
| Filas `sintergia.app_state` | 0 |
| Filas `sintergia.sync_operations` | 71 |
| Filas con `payload` o `result` JSONB que no es objeto | 71 |
| Filas en estado `applied` | 71 |

Los 71 registros están marcados `applied`, pero los 71 almacenan `payload` o `result` como escalares JSONB (cadenas), no como objetos. La tabla `app_state` está vacía. Por tanto, los registros históricos no demuestran que el estado funcional de la aplicación se haya persistido. No se modificó ninguna fila.

Las funciones activas consultadas son `sync-operations` v14 y `realtime-snapshot` v15, ambas con `verify_jwt=false` y validación HMAC personalizada. Esta configuración solo es segura si cada ruta valida correctamente la sesión HMAC y su alcance. En `sync-operations`, las operaciones delta que no se aplican devuelven `405` para activar el fallback a snapshot; falta comprobar el comportamiento exacto de la cola local en el navegador para garantizar que solo marque una operación como sincronizada después de recibir confirmación de un snapshot persistido.

## 3. Discrepancia de rutas de despliegue

`DEPLOY.md` propone ejecutar:

```bash
node supabase/functions/sync-operations/test-contract.cjs
deno check supabase/functions/sync-operations/index.ts
```

Sin embargo, el árbol de la rama `main` consultado muestra `index.ts` y `test-contract.cjs` en la raíz, no dentro de `supabase/functions/sync-operations/`. Las rutas documentadas no coinciden con el árbol observado y probablemente fallarán desde la raíz sin reorganización o corrección de la guía.

## 4. Bloqueo de escritura de GitHub

Se intentó crear una rama nueva basada en `main` para proponer el arreglo. GitHub respondió `403 Resource not accessible by integration`. No se pudo escribir el parche en el repositorio ni abrir una PR. `main` no se modificó en esta sesión.

## 5. Pruebas ejecutadas sobre los archivos del ZIP

- `node --check sw.js`: sintaxis JavaScript válida.
- `node --check test-sw-guard.cjs`: sintaxis de la prueba válida.
- `node test-sw-guard.cjs`: tres grupos de comprobaciones estáticas aprobados.
- Integridad del ZIP: comprobada mediante `unzip -t`.

Las pruebas son estáticas/locales. No simulan el navegador, activación del service worker, biometría, peticiones HMAC ni sincronización concurrente. No se declara corregida la producción.

## 6. Pruebas que siguen pendientes

1. Comprobar en un navegador de prueba que el documento servido/cacheado contiene una etiqueta script correctamente cerrada y que `offline-guard.js` se ejecuta antes que los scripts de aplicación.
2. En dos dispositivos de prueba, crear un cambio identificable y confirmar su lectura en ambos, junto con la versión de snapshot.
3. Cortar la conexión mientras se envía un cambio y verificar que la cola local conserva el cambio hasta recibir confirmación persistida.
4. Repetir un `requestId` con el mismo contenido y luego reutilizarlo con contenido distinto: el primero debe ser idempotente y el segundo entrar en conflicto.
5. Verificar aislamiento de estado entre sesiones técnico/admin/demo; un usuario no debe poder indicar el identificador de estado de otro.
6. Reconciliar los 71 registros históricos con una estrategia respaldada; no borrarlos ni convertirlos automáticamente sin copia y plan de recuperación.

## 7. Qué no modifica este paquete

No modifica el HTML principal, Edge Functions, base de datos, secretos, políticas RLS, credenciales ni configuración de autenticación. Tampoco repara por sí solo los problemas de sincronización. Es un parche reducido para el service worker, que necesita una prueba controlada antes de producción.
