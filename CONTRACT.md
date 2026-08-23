# Shared site contract

Every site built from this foundation follows the same edge contract.

## Worker entrypoint

`createWorker({ fetch, auth?, scheduled?, security? })` owns the Worker lifecycle.
The site router owns pages, APIs, D1 queries, and R2 object keys. `scheduled`
is optional and must use `ctx.waitUntil` for background work.

## Routes

- `GET /health` returns `{ ok, version, build_number }` and is cache-disabled.
- `GET /api/me` returns `{ user: null | { sub, email, name, ...roles } }`.
- `/auth/login`, `/auth/callback`, and `/auth/logout` are reserved for auth.
- Public APIs must be explicitly listed in auth configuration.
- Mutating `/api/*` requests require a same-origin `Origin` header.

## Environment and bindings

Required OIDC secrets for the standard auth plugin:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `AUTH_SESSION_SECRET`

Standard bindings:

- `DB`: primary D1 database for durable application records.
- `ASSETS`: static asset binding when the site has a frontend bundle.
- `R2_*`: optional R2 buckets for files or photos; use a descriptive suffix.

Build metadata is optional: `BUILD_SHA` and `BUILD_NUMBER`.

D1 migrations are committed with the site, applied by Wrangler, and are the
source of truth for schema changes. R2 stores binary data; metadata and access
control remain in D1.

## User and role contract

Auth returns a stable `sub`, normalized lowercase `email`, and display `name`.
Applications may add roles or an internal D1 user id in `onLogin`; authorization
must remain in the application router rather than in the shared auth package.
