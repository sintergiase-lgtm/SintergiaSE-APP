# SintergiaSE — versión unificada Supabase / GitHub Pages

Fecha: 2026-10-07

Esta versión usa como base el HTML maestro de Google Cloud/Supabase:
`SintergiaSE_GOOGLE_MAESTRO.html`.

## Decisión de unificación

Se conserva la configuración explícita de Supabase del maestro. No se sustituyen
las llamadas `https://bgjicsowspppsjzigazb.supabase.co/functions/v1/...` por
rutas relativas `/functions/v1/...`, porque GitHub Pages es un frontend estático
y esas rutas relativas necesitarían un proxy/rewrite en el mismo origen.

También se conserva el puente de compatibilidad del maestro, la autenticación
de backend en producción, la sincronización y el registro de Edge Functions.

## Estado de verificación

- Comparación realizada contra el `index.html` del ZIP de GitHub Pages.
- El `index.html` del ZIP y el `index.html` descomprimido eran idénticos.
- El HTML unificado supera la comprobación sintáctica de sus bloques JavaScript.
- No se ha podido realizar una prueba HTTP real contra Supabase desde este
  entorno, por lo que esta entrega NO debe considerarse una verificación
  E2E del backend en producción.

## SHA-256

`e51261ac396440cc0e15f1f5d563c06fde1a7e9bf1f2bbe9f8f55082ac4acb1e`

## Tamaño

3313966 bytes
