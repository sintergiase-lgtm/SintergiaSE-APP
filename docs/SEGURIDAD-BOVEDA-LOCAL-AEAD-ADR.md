# ADR: migración de la bóveda local a cifrado autenticado

- **Fecha:** 16-10-2026
- **Estado:** decisión de arquitectura; implementación pendiente
- **Alcance:** persistencia local de datos operativos y modo demo

## Decisión

La bóveda nueva usará **IndexedDB para persistir ciphertext** y **Web Crypto AES-GCM** para cifrar y autenticar cada registro. El acceso a la bóveda tendrá una interfaz asíncrona con operaciones de lectura, escritura, eliminación y `flush()`/confirmación durable. La migración debe completar y verificar la escritura antes de retirar el formato anterior.

No se sustituirá solo el cuerpo de `cifrar()` en la intercepción actual de `Storage.prototype`. Esa interfaz es síncrona, mientras que las operaciones `SubtleCrypto` devuelven promesas. Si `setItem()` devuelve antes de que AES-GCM y la escritura durable terminen, las rutas existentes pueden indicar que guardaron aunque el ciphertext no se haya persistido.

## Evidencia del código actual

- `index.html` y `SintergiaSE_biometria_reparada_consolidada_v4-sync-auth.html` duplican el módulo `sintergia-storage-crypto-v1`.
- El módulo intercepta `localStorage.getItem/setItem/removeItem`, mantiene datos descifrados en memoria y escribe el formato propio `SGX1`.
- El guardado de estado de negocio llama a `localStorage.setItem()` de forma síncrona; el evento de guardado dispara la sincronización inmediatamente. Hay decenas de llamadas directas y 124 invocaciones a `guardarEstadoStorage()` sumadas entre los dos HTML mantenidos.
- Las funciones de almacenamiento incluyen el almacén operativo compartido, el almacén demo, colas, snapshots, configuración y recibos. La lista `SENS` no cubre por sí sola todos los datos sensibles.
- La DEK operacional es común para admin y técnico. Hoy `CLAVE_DATOS_APP` permite abrir envolturas creadas por versiones anteriores, por lo que quitarla o ignorarla sin enrolar todas las identidades puede bloquear datos existentes.

## Formato objetivo

- DEK aleatoria de 256 bits por bóveda local.
- AES-GCM con etiqueta de autenticación de 128 bits y AAD que vincule versión, tenant, identidad, perfil y nombre de registro. Los metadatos de cifrado deben validarse antes de aceptar el plaintext.
- Nonces de 96 bits, únicos por clave. Reservarlos mediante una secuencia transaccional de IndexedDB para evitar reutilización incluso con pestañas concurrentes; un fallo puede dejar huecos, nunca reutilizar un nonce.
- Envolver la DEK por identidad autorizada con un secreto no público y sal/parametrización explícitas. La clave de demo tendrá una bóveda distinta. Los secretos de recuperación no se guardarán en HTML, `localStorage` ni `sessionStorage`.
- Identidad y `tenant_id` verificados por el backend. Las credenciales compartidas por modo actuales no ofrecen el ciclo de alta, baja, revocación y recuperación que necesita el envoltorio por usuario.

AES-GCM proporciona cifrado autenticado y admite datos asociados autenticados; Web Crypto lo expone mediante operaciones asíncronas. La reutilización de IV bajo una misma clave está prohibida por el diseño del formato. Referencias: [W3C Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/#aes-gcm), [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).

## Migración y recuperación

1. Inventariar cada clave persistente y su dueño: estado principal, configuración, colas offline, snapshots, archivos, copias, biometría, demo y metadatos. Documentar qué valores se sincronizan y a qué tenant pertenecen.
2. Separar las operaciones de persistencia del `Storage.prototype` global. La memoria puede dar lecturas síncronas al renderizador, pero cada escritura de negocio debe esperar una confirmación durable antes de declararse guardada o enviarse a sincronización.
3. Crear la bóveda nueva vacía en fixtures sintéticas y validar permisos, cuota, concurrencia, offline, cierre de pestaña y fallos de IndexedDB/Web Crypto.
4. Escribir un diario de migración versionado. Leer SGX1 solo durante transición; descifrar sin sobrescribir, cifrar cada clave en v2, releerla, comparar el valor en memoria y registrar el avance. Reanudar en cualquier punto sin duplicar, vaciar ni borrar datos.
5. Antes de retirar una envoltura antigua, demostrar que las identidades requeridas abren la bóveda nueva en dos dispositivos y que una exportación independiente puede restaurarse. Fallos de autenticación, manipulación, cuota, cierre o interrupción deben dejar el estado recuperable y bloquear la aplicación con un mensaje concreto.
6. Mantener compatibilidad de lectura temporal durante la ventana acordada. La limpieza de ciphertext y envolturas heredadas es una operación posterior, auditable y condicionada a restauración verificada; no forma parte de la primera migración.

## Pruebas de salida

Con fixtures exclusivamente sintéticas:

- igualdad de registros y metadatos antes/después, incluidas listas vacías y valores grandes;
- alteración de ciphertext, etiqueta, nonce y AAD; cambio de clave, tenant, usuario, perfil o nombre de registro;
- interrupción y reanudación tras cada checkpoint; cuota agotada; dos pestañas escribiendo; cierre y recarga mientras hay operaciones pendientes;
- apertura, exportación y restauración en dos dispositivos; enrolamiento, cambio de credencial, revocación y recuperación;
- modo demo incapaz de leer o escribir el almacén operativo;
- suites funcionales de sincronización offline y de módulos que guardan mediante `guardarEstadoStorage()`.

## Bloqueos y límites

La implementación debe empezar por identidad individual y almacenamiento por tenant/usuario. Hasta entonces, quitar la clave pública o las envolturas heredadas puede dejar sin acceso a admin/técnico; conservarlas mantiene el riesgo. Esta decisión no corrige por sí sola la exposición actual, no valida el despliegue y no habilita datos reales. La PR #28 solo mejora el comportamiento fail-closed.

No se ejecutará una migración sobre perfiles reales ni se cambiará el backend productivo como parte de la implementación inicial. Primero se completa y revisa el cambio, se valida con datos sintéticos en una vista previa aislada y se prepara una restauración comprobada.