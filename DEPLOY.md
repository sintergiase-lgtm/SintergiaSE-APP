# SintergiaSE — sync-operations deployment notes

## Important status

This folder is a reviewed deployment candidate. Do not deploy it to production until the PR is reviewed and the integration tests described below pass. It intentionally preserves the current custom HMAC session scheme, so the Supabase Edge Function must continue to have `verify_jwt=false` and must still validate the `v1.<payload>.<signature>` token in its own code.

## What this candidate changes

- Claims a `request_id`, writes the app snapshot, and saves the acknowledgement in one PostgreSQL transaction.
- Uses explicit JSONB casts so the stored payload/result are JSON objects rather than JSON string scalars.
- Returns `409` when a request ID is reused for different content.
- Returns `503` rather than misreporting a database/secret infrastructure failure as an invalid user session.
- Bounds request bodies and restricts browser CORS to GitHub Pages plus explicitly configured HTTPS origins.
- Returns `405` for delta operations this endpoint does not persist, allowing the current client to use its snapshot fallback instead of losing operations behind a false success.

## Local/Cloud Shell checks

From the repository root:

```bash
node supabase/functions/sync-operations/test-contract.cjs
```

If Deno is installed, also run:

```bash
deno check supabase/functions/sync-operations/index.ts
```

Check the existing function's authentication setting before deployment; this implementation uses the application's custom HMAC token and is not a Supabase JWT endpoint. Deploy only after approval and after confirming the project's existing `ALLOWED_ORIGINS` secret includes any real secondary HTTPS origin (for example, an app wrapper domain). Do not use `*` as an origin.

```bash
supabase functions deploy sync-operations --project-ref bgjicsowspppsjzigazb --no-verify-jwt
```

After deployment, test with an authenticated, non-production snapshot under a designated test ID; verify a write/read round trip, the returned version, duplicate request IDs, concurrent duplicate requests, and the `405` fallback for delta operations. Do not use real invoice/client data for destructive tests.

## Not included

This folder does not alter `index.html`, `authenticate`, `register-biometric`, secrets, RLS policies, or the existing production function. Offline biometric access remains a separate blocked task until the signed-permit module and server-side private key are available and verified.
