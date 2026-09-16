# Shared site contract

Every site built from this foundation follows the same edge contract.

## API, UI, and repositories

`defineRoute({ method, path, auth, scope, csrf, handler })` defines a route
contract. Applications pass contracts through `createWorker({ apiRoutes })`;
base enforces authentication, administrator status, same-origin mutation
rules, and scope checks before invoking the handler. `@agilesyndrome/cf-genai-base/api`
also exposes `apiFetch` and `apiJson` for browser clients.

`createRepositories(env, definitions)` creates named application or feature
repositories over the request-scoped data reader. Definitions may declare
relations to other repositories. Repositories must not expose raw D1 or accept
unvalidated table, column, or SQL fragments from callers.

## Worker entrypoint

`createWorker({ fetch, features?, middleware?, auth?, authorize?, scheduled?, security? })` owns the Worker lifecycle and reserved admin boundary. Features run in declaration order and may call `next()` or return a response. A feature may also declare `{ routes: [{ match, handle }] }`; matching handlers receive `{ request, env, ctx, state, next }` and run before the site handler. The site router owns pages, APIs, D1 queries, and R2 object keys. `scheduled`
is optional and must use `ctx.waitUntil` for background work.

## Routes

- `GET /health` returns `{ ok, version, build_number }` and is cache-disabled.
- `GET /api/me` returns `{ user: null | { sub, email, name, ...roles } }`.
- `/auth/login`, `/auth/callback`, and `/auth/logout` are reserved for auth.
- `/admin` and `/admin/*` are browser admin routes; `/api/admin` and `/api/admin/*` are admin API routes.
- Admin routes use `AUTH_STRATEGY`; omitted or empty means `http_basic`. Basic auth accepts username `admin` and the value of `ADMIN_TOKEN`. Missing token means all admin routes return 401.
- `AUTH_STRATEGY=oauth` delegates identity establishment to the configured auth provider and uses `authorize` for admin policy.
- `scopes` registers an application scope manifest. `scopeRoutes` associates route prefixes or match functions with required scopes.
- Base protects `/admin` and `/api/admin`; browser pages are React applications that consume the JSON admin APIs. Import `AdminShell` and the platform catalogs from `@agilesyndrome/cf-genai-base/ui` and apply the application's theme around them.
- Base provides `/api/admin/users`, `/api/admin/scopes`, `/api/admin/groups`, `/api/admin/status`, `/api/admin/features`, `/api/admin/healthchecks`, `/api/admin/circuit-breakers`, and `/api/admin/users/:id/scopes|groups` for platform administrators when the authorization and core migrations are installed. It also provides short-lived `/api/admin/users/:id/impersonate` and `/api/admin/impersonate/clear` controls. `GET /api/tenant` returns the authenticated active tenant and validated memberships; invalid `X-Tenant-ID` values return 400. `GET /api/admin/features` returns the installed runtime feature manifests, package names and versions, per-feature health rollups, healthchecks, and circuit breakers. React platform components consume these JSON APIs. Feature manifests may provide `name`, `displayName`, `packageName`, and `version`.
- Public APIs must be explicitly listed in provider-specific auth configuration.
- Mutating `/api/*` requests require a same-origin `Origin` header.
- `createWorker` supplies request-scoped `data`, `user`, `authUser`, `userId`, `context`, `event`, and audited D1 access to route handlers. `Event(who, what, where, when, details)` creates normalized events; installed features may consume them through `eventHandler`.
- `migrations/0006_jobs.sql` adds generic durable jobs and job events. Features create and update jobs with the exported lifecycle helpers; `GET /api/jobs`, `GET /api/jobs/:id`, and `GET /api/jobs/:id/events` expose only the authenticated owner's records. `GET /api/events` is an optional authenticated WebSocket stream backed by the configured `EVENT_HUB` Durable Object.

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

The package includes ordered migrations. Each site must apply
`migrations/0001_authorization.sql` before enabling the generic user/scope APIs,
`migrations/0004_tenants.sql` for tenant membership and subscriptions, and
`migrations/0006_jobs.sql` before creating or reading durable jobs.
The tenant migration seeds the `Easley Family` tenant and `VIP` subscription,
and migrates existing authorization users into that tenant.

D1 migrations are committed with the site, applied by Wrangler, and are the
source of truth for schema changes. R2 stores binary data; metadata and access
control remain in D1.

## User and role contract

Auth returns a stable `sub`, normalized lowercase `email`, and display `name`.
Applications may add roles or an internal D1 user id in `onLogin`; authorization
must remain in the application router rather than in the shared auth package.

## Scoped data contract

`createWorker` accepts `dataResources`, and features may expose the same
manifest through `feature.dataResources`. Each resource must declare a safe
name, table, explicit columns, and one scope: `user`, `tenant`, `public`, or
`system`. Public resources are read-only and predicate on the worker's
`publicTenantId`, including for authenticated users.
Resources may also declare allowed operations (`read`, `create`, `update`, and
`delete`); reads support bounded native pagination through
`reader.page({ limit, offset })` and `reader.count()`, plus safe filtered
updates and deletes. Anonymous tenant reads require an explicit worker
`publicTenantId` and a resource-level `publicRead` declaration; object form
adds a row visibility predicate.
Request handlers receive `state.data`, whose scope-specific readers apply the
validated user or tenant predicate. Domain handlers must not use unrestricted
`readableColumns` list the only columns returned by reads; callers must declare
them explicitly. Base cannot provide row-level security to
direct D1 calls, so applications must keep raw database access out of domain
features. The cookbook migration must add and backfill `tenant_id` on recipe
tables, register recipes as tenant-scoped, replace direct D1 reads/writes with
`state.data.tenant`, and add cross-tenant isolation tests. The companion
`cf-genai-cli` should lint `cf-genai-*` working folders for direct
`env.DB.prepare(` usage as a follow-up enforcement check.
Scoped write violations are returned as a generic 403 response; the detailed
scope/resource identity is retained in the audit log only.
