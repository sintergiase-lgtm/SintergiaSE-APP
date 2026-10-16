# Revisión de seguridad de Supabase — 16/10/2026

## Alcance

Consulta de solo lectura del proyecto de producción `SintergiaSE` (`bgjicsowspppsjzigazb`). Se revisaron metadatos de esquema, permisos, alertas de Supabase y el cuerpo de `sintergia.auth_check`. No se consultaron valores de contraseñas, hashes, secretos, snapshots ni datos operativos. No se modificó producción.

## Controles que sí están cerrados

- Las 14 tablas observadas en el esquema privado `sintergia` tienen RLS activado.
- `anon` y `authenticated` no tienen `USAGE` en `sintergia` ni privilegios sobre sus tablas. `service_role` tampoco tiene acceso directo al esquema; las funciones Edge usan `SUPABASE_DB_URL` para acceder al esquema privado.
- `sintergia.auth_check` y `sintergia.touch_app_state_v18` son `SECURITY DEFINER`, fijan `search_path` vacío y no conceden `EXECUTE` a `anon` ni `authenticated`.
- El aviso `RLS Enabled No Policy` de las tablas privadas es informativo en esta configuración: esas tablas no están expuestas mediante grants al cliente. No añadir políticas abiertas para silenciarlo.

## Riesgos que siguen abiertos

1. **Bloqueo global del acceso:** `auth_check` mantiene un contador global por ámbito y bloquea todos los inicios de sesión de ese ámbito durante 15 minutos al alcanzar 40 fallos. Como esos fallos se agregan entre IPs, un atacante distribuido puede provocar indisponibilidad de acceso. El límite por IP es cinco fallos en 15 minutos.
2. **Identidad compartida:** el login acepta un ámbito y una contraseña compartida. Los tokens usan el identificador devuelto por esa comprobación y fijan el tenant a `sintergia`; no hay identidad de miembro individual ni aislamiento multiempresa en ese contrato.
3. **Revocación de sesiones:** `jti` identifica cada token, pero no existe validación de revocación en cada solicitud. Un token robado continúa válido hasta su expiración, que puede ser de hasta ocho horas.

## Siguiente cambio de base de datos

Antes de cambiar `auth_check`, versionar el contrato y su migración en el repositorio, probar el comportamiento con credenciales sintéticas en QA y revisar disponibilidad frente a fuerza bruta y bloqueo de servicio. `qa/supabase/migrations` contiene fixtures locales y no debe aplicarse a un proyecto alojado. La corrección no se ha ejecutado en producción ni en QA.

## Límite de esta revisión

Esta auditoría confirma permisos de esquema y la configuración observada al consultarla; no sustituye una prueba HTTP externa de la Data API, una prueba de login con cuenta sintética en QA ni una revisión de sesiones en dispositivos reales.

