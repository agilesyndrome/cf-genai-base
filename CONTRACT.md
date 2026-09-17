# Shared site contract

Every site built from this foundation follows the same edge contract.

## API, UI, and repositories

`AppDomain` owns route contracts alongside a concept's model, views, data
resources, and repositories. Applications register domains through
`defineApp({ domains })`; base gives every domain route to Hono and enforces
authentication, administrator status, same-origin mutation rules, custom
policies, and scope checks before invoking the handler. `defineRoute` remains
the low-level contract helper used by the domain dispatcher.

`defineApp` snapshots and freezes its manifest arrays. TypeScript consumers
retain the concrete domain and feature registration types, and built-in
`defineFeature` options are selected from the feature name.

The `/api` browser client returns `JsonValue | Response`: empty, `null`, or
non-JSON success bodies preserve the original unread `Response`. Callers that
need a narrower JSON result pass a `validateJson` type guard, which both checks
the untrusted payload and infers the result type. `ApiError` exposes only the
safe server message, HTTP `status`, and `X-Request-ID` as `requestId`.

Core security helpers expose typed same-origin inputs, bounded JSON-object
reading results, status-bearing request errors, and secure response helpers;
JSON parsing remains runtime-validated and request bodies are read from clones.

`createRepositories(env, definitions)` creates named application or domain
repositories over the request-scoped data reader. Definitions may declare
relations to other repositories. Repositories must not expose raw D1 or accept
unvalidated table, column, or SQL fragments from callers.

## Worker entrypoint

`createWorker({ fetch, app, middleware?, authorize?, scheduled?, security? })` owns the Worker lifecycle and reserved admin boundary. An application requests built-ins with `defineApp({ name, features: [defineFeature("llm", options), defineFeature("messaging", options)] })`; base resolves only those registrations and ignores every unrequested built-in. External feature objects are registered in the same `app.features` array. Business APIs, views, data resources, and repositories are composed through `AppDomain` instances registered in `app.domains` or `feature.domains`. Duplicate and unknown features fail during Worker construction. Feature middleware runs in declaration order and may call `next()` or return a response; feature endpoints must be domains so Hono remains the only route matcher. The site router owns pages that are not supplied by a domain. `scheduled`
is optional and must use `ctx.waitUntil` for background work.

## Routes

- `GET /health` returns `{ ok, version, build_number }` and is cache-disabled.
- `GET /api/me` returns `{ user: null | { sub, email, name, ...roles } }`.
- `/auth/login`, `/auth/callback`, and `/auth/logout` are reserved for auth.
- `/admin` and `/admin/*` are browser admin routes; `/api/admin` and `/api/admin/*` are admin API routes.
- Admin routes use `AUTH_STRATEGY`; omitted or empty means `http_basic`. Basic auth accepts username `admin` and the value of `ADMIN_TOKEN`. Missing token means all admin routes return 401.
- `AUTH_STRATEGY=oauth` delegates identity establishment to the configured auth provider and uses `authorize` for admin policy.
- Domain route `scopes` register the application scope manifest and enforce access at the exact Hono route. Use `scopeMode: "any"` when any declared scope is sufficient; the default requires all declared scopes.
- Base protects `/admin` and `/api/admin`; browser pages are React applications that consume the JSON admin APIs. `AdminDashboard` is the complete single-route administration UI; it includes all platform catalogs and owns internal list/detail navigation. `AdminShell` and the individual components remain available for custom routed interfaces.
- Base provides list/detail APIs for users, groups, tenants, features, healthchecks, and circuit breakers, plus relationship replacement for user scopes, groups, and tenants. Built-in admin domains declare delegated `users:*`, `groups:*`, `tenants:*`, `operations:*`, `subscriptions:*`, and `impersonation:start` capabilities; platform administrators satisfy all route capabilities. It also provides short-lived impersonation controls. `GET /api/tenant` returns the authenticated active tenant and validated memberships; invalid `X-Tenant-ID` values return 400. React platform components consume these JSON APIs.
- Public APIs must be explicitly listed in provider-specific auth configuration.
- Mutating `/api/*` requests require a same-origin `Origin` header.
- `createWorker` supplies request-scoped `data`, `user`, `authUser`, `userId`, `context`, `event`, and audited D1 access to route handlers. `Event(who, what, where, when, details)` creates normalized events; installed features may consume them through `eventHandler`.
- `migrations/0006_jobs.sql` adds generic durable jobs and job events. Features create and update jobs with the exported lifecycle helpers; `GET /api/jobs`, `GET /api/jobs/:id`, and `GET /api/jobs/:id/events` expose only the authenticated owner's records, while `POST /api/jobs/:id/cancel` cancels an owned queued/running job. Administrators may request `GET /api/jobs?all=true`. `GET /api/events` is an optional authenticated WebSocket stream backed by the configured `EVENT_HUB` Durable Object.

## Environment and bindings

Required OIDC secrets for the standard auth plugin:

- `OIDC_DISCOVERY_URL`
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
`migrations/0006_jobs.sql` before creating or reading durable jobs. Apps that
request messaging also apply `migrations/0007_messaging.sql`.
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

Domains expose persistence manifests through `domain.dataResources` and
`domain.repositories`; apps and features register those domains. Each resource must declare a safe
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
`state.data.tenant`, and add cross-tenant isolation tests. The bundled
`cf-genai` command lints `cf-genai-*` working folders for direct
`env.DB.prepare(` usage as a follow-up enforcement check.
Scoped write violations are returned as a generic 403 response; the detailed
scope/resource identity is retained in the audit log only.
