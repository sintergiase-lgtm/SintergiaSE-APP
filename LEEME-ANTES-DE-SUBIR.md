# SintergiaSE — paquete de reparación, iteración 7

## Contenido

- `sw.js`: reemplazo candidato del service worker en la raíz del repositorio.
- `test-sw-guard.cjs`: prueba estática local del cierre de etiqueta, versión de caché y exclusión de API/auth.
- `ITERACION-7-HALLAZGOS.md`: hallazgos y validaciones/limitaciones de esta iteración.

## Cómo usarlo

1. Descarga el ZIP y descomprímelo.
2. En el repositorio `sintergiase-lgtm/SintergiaSE-APP`, haz una copia de seguridad del `sw.js` actual.
3. Sustituye únicamente el `sw.js` de la raíz por el incluido en el ZIP.
4. Ejecuta `node --check sw.js` y `node test-sw-guard.cjs` desde esta carpeta antes de publicar.
5. Sube primero a una rama de prueba y valida la app desde un navegador/dispositivo de prueba. No lo publiques directamente como solución completa de sincronización.

La versión de caché cambia de `v5` a `v6`; al activar el service worker, elimina cachés antiguos cuyo nombre empiece por `sintergiase-shell-`. No está diseñada para borrar `localStorage` ni `IndexedDB`, pero conviene validar el arranque offline tras actualizar.

## Límites importantes

Este paquete no cambia el HTML principal, Edge Functions, base de datos, secretos, permisos ni políticas RLS. No corrige las 71 filas históricas ni demuestra una sincronización multidispositivo correcta. Tampoco se ha probado en navegador real. No se debe considerar la producción corregida hasta pasar las pruebas de regresión indicadas en el informe.
