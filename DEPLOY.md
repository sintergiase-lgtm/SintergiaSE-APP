# SintergiaSE — sync-operations deployment notes

## Important status

**Do not deploy this candidate to production.** The active production `sync-operations` function was inspected on 2026-10-16 and is already at version 15 (`verify_jwt=false`) with custom HMAC validation, transactional writes, JSONB type checks, and the `405` delta fallback. The v13 source described here is an older candidate from draft PR #8; its isolated Supabase integration verification is still pending. Deploying it to production would replace the newer active version with stale code.

The candidate keeps the custom HMAC session scheme, so any isolated test deployment must retain `verify_jwt=false` and validate the `v1.<payload>.<signature>` token in its own code. Run the checks and deployment below only from the PR #8 candidate branch and only against a separate, explicitly designated test project. The candidate source and contract test are not present on `main`.

## What the v13 candidate changes (not deployed)

- Claims a `request_id`, writes the app snapshot, and saves the acknowledgement in one PostgreSQL transaction.
- Uses explicit JSONB casts so the stored payload/result are JSON objects rather than JSON string scalars.
- Returns `409` when a request ID is reused for different content.
- Returns `503` rather than misreporting a database/secret infrastructure failure as an invalid user session.
- Bounds request bodies and restricts browser CORS to GitHub Pages plus explicitly configured HTTPS origins.
- Returns `405` for delta operations this endpoint does not persist, allowing the current client to use its snapshot fallback instead of losing operations behind a false success.

## Local/Cloud Shell checks

From the root of the PR #8 candidate branch (these paths are not present on `main`):

```bash
node supabase/functions/sync-operations/test-contract.cjs
```

If Deno is installed, also run:

```bash
deno check supabase/functions/sync-operations/index.ts
```

This deployment command is only for an isolated QA project. Set `TEST_PROJECT_REF` to a separate, designated test project; never substitute the production ref. Confirm that its `ALLOWED_ORIGINS` secret includes the QA HTTPS origin. Do not use `*` as an origin. This application uses a custom HMAC token, not a Supabase JWT endpoint.

```bash
supabase functions deploy sync-operations --project-ref "$TEST_PROJECT_REF" --no-verify-jwt
```

After deployment, test with an authenticated, non-production snapshot under a designated test ID; verify a write/read round trip, the returned version, duplicate request IDs, concurrent duplicate requests, and the `405` fallback for delta operations. Do not use real invoice/client data for destructive tests.

## Not included

This candidate must not alter `index.html`, `authenticate`, `register-biometric`, production secrets, RLS policies, or the existing production function. Offline biometric access remains a separate blocked task until the signed-permit module and server-side private key are available and verified.
