# QA local de snapshots

Este conjunto es solo para CI local/efímero. No contiene datos, claves ni configuración del proyecto remoto y no se aplica a un Supabase alojado.

El workflow copia aquí la función `realtime-snapshot` v16 que está activa en el proyecto y una migración sintética mínima a un directorio temporal `supabase/`. El test extrae del HTML de la rama las rutinas reales `postSnapshot`, `obtenerRemoto` y `snapshotCoincideConRemoto`, pero redirige las llamadas exclusivamente a `127.0.0.1`.

Cubre:

- sesión personalizada HMAC firmada con un valor sintético;
- POST autenticado, GET desde otro dispositivo lógico y coincidencia exacta de `sourceId` y `revision`;
- rechazo de sesión ausente o firma inválida;
- comprobación de que una revisión más alta o un origen distinto no confirma el snapshot previo.

No reproduce el esquema completo de producción ni sustituye una prueba manual en dos teléfonos/navegadores. La app usa una sesión HMAC propia, no Supabase Auth. No se hacen llamadas de escritura al proyecto alojado, no se crean ramas Supabase y no se necesitan secretos de CI.
