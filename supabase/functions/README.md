# Supabase Edge Functions

These sources match the deployed access and synchronization functions as of 2026-10-16. They are now versioned here so future reviews and regression checks can compare the repository with production.

## Functions

- `authenticate` — issues and validates the app's HMAC-backed session flow; `session.ts` is a required relative dependency.
- `realtime-snapshot` — reads and writes the authenticated user's current snapshot.
- `sync-operations` — applies authenticated operations and handles request idempotency.

The Supabase gateway has `verify_jwt=false` for these functions because the application uses its own HMAC session format rather than Supabase Auth JWTs. Each protected handler validates that session before accessing data. Keep the session verification in place; do not rely on CORS as authentication.

## Deployment boundary

This repository does not yet own the production schema, migrations, or all database routines used by the application. Do not apply the local fixture migrations under `qa/supabase` to a hosted project. QA tests must use synthetic accounts and data. Function source updates can be deployed independently only after the matching SQL contract is present in the target environment.

No keys, passwords, production data, or environment values belong in this directory. Configure secrets through the Supabase project environment.
