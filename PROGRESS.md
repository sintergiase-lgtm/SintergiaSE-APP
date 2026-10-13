# PROGRESS — P1 candidate security

Fecha: 2026-10-13

## Alcance del ciclo

- Rama: `fix/p1-candidate-auth-and-receipt-tests-20261013`, basada en `audit/correcciones-2026-10-13` (`d655f53cb6721a8e5db3a40916c17ff033852abe`).
- Corrección: distinguir fallo de infraestructura/secret HMAC ausente (503 recuperable) de token inválido (401) en candidatos de recibos, correo y AI gateway.
- Portabilidad: sustituir rutas absolutas `/mnt/data` y ruta fija de TypeScript por rutas relativas al repositorio y dependencia instalada por workflow.
- Pruebas: ampliar reglas de verificación de recibos; ejecutar CORS exacto y validación HMAC con token simulado; comprobar que DB/secret ausentes se propagan como error de infraestructura y el handler lo traduce a 503.
- CORS: los tres candidatos permiten solo los orígenes listados en `ALLOWED_ORIGINS`; la prueba rechaza sufijos maliciosos.

## Bloqueos no resueltos

- Gmail idempotency: `send-email-v14-candidate.ts` aún llama a Gmail antes de insertar `email_messages`. Sin una clave idempotente persistida y esquema/constraint confirmado, un retry tras fallo de DB puede duplicar el correo. No se ha cambiado ese flujo ni se ha inventado una migración.
- Cuotas IA: `ai-gateway-v14-candidate.ts` limita tamaño/modelo, pero no aplica una cuota por usuario/sesión/coste. No se añade una tabla RPC sin esquema confirmado.
- Las pruebas HMAC usan un secreto local simulado; no verifican los secrets ni la función desplegada en Supabase.

## Estado

- CI verificado en verde: [run 38450457805](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38450457805). Pasaron tests portables de recibos/correo, invariantes de candidatos y simulaciones de CORS/HMAC para los tres candidatos.
- No se modifica `main`, producción, Supabase ni secrets.
