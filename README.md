# `@agilesyndrome/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The package also ships the `cf-genai` command. Runtime, administration, D1,
project automation, and release tooling are versioned and published together;
there is no separate CLI dependency.

The base owns the shared security boundary as well as Worker lifecycle concerns. It reserves `/admin` and `/api/admin` routes, authenticates them using `AUTH_STRATEGY` (default `http_basic`, or `oauth` when an auth provider is supplied), and applies the optional `authorize` policy. Sites still own their router, HTML, D1 queries, R2 keys, and scheduled jobs.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

Base also provides provider-neutral authorization helpers and browser components
through `@agilesyndrome/cf-genai-base/auth` and
`@agilesyndrome/cf-genai-base/ui`. Applications declare their scope manifest,
while base owns the user, scope, and grant records plus the generic user-access
API. The UI components are themeable with CSS custom properties and do not
contain application-specific components.

```js
import { createWorker, healthResponse } from "@agilesyndrome/cf-genai-base";

export default createWorker({
  features: [auth],
  fetch: async (request, env) => {
    if (new URL(request.url).pathname === "/health") return healthResponse(env);
    return router(request, env);
  },
});
```

Features expose `middleware(request, env, ctx, next, state)` and may short-circuit reserved routes, attach request state, or call `next()`.

Base protects `/admin` and `/api/admin`; the React UI package owns the browser
pages. Import `AdminShell` and the platform catalogs from
`@agilesyndrome/cf-genai-base/ui`. Sites provide their own application links and
theme while the base components consume the shared JSON admin APIs.

## Command-line tools

Install base in a project (or globally) and use the bundled executable:

```sh
npm install @agilesyndrome/cf-genai-base
npx cf-genai version

cf-genai check
cf-genai test
cf-genai ci
cf-genai dev
cf-genai upgrade base latest
cf-genai release --confirm
cf-genai release-status --wait 3
```

Projects upgrading from the standalone package should remove
`@agilesyndrome/cf-genai-cli`; their existing base dependency now supplies the
same `cf-genai` executable.

The CLI includes all commands formerly published by
`@agilesyndrome/cf-genai-cli`: project checks and releases, scoped-data linting,
package upgrades with migration vendoring, D1 refresh/backup/restore/migration,
site status, and user, tenant, healthcheck, circuit-breaker, and platform admin
operations.

```sh
cf-genai status --env staging
cf-genai d1 refresh local
cf-genai d1 migrate production --confirm-production
cf-genai d1 backup production --output ./backup.sql --confirm-production
cf-genai admin features --env staging
cf-genai admin users --env staging
cf-genai tenant list --env staging
cf-genai user get someone@example.com --env staging
cf-genai healthchecks set llm:provider red --env staging
cf-genai circuit-breakers set llm:provider tripped --env staging
```

See [CLI.md](CLI.md) or run `cf-genai --help` for the complete command grammar. Credential loading
stays outside the command, so a repository can continue to wrap it with
`op run --env-file=.env.op --`. Destructive remote operations retain their
existing explicit confirmation flags.

## Shared platform helpers

`createWorker` can own `/health` and `/api/health`, and run a boot validator
before requests. Use `assertBoot(env, { bindings: ["DB"], required:
["AUTH_SESSION_SECRET"] })` in a site initializer to fail closed when its
Cloudflare configuration is incomplete.


## Core operational services

The package is organized by responsibility: `runtime` composes Workers,
`core` owns request/event/security/D1 primitives, `auth` owns authorization
data access, `api` owns route contracts and the browser client, `admin` owns
platform administration, and `ui` owns shared browser components. Each
responsibility has a canonical folder entrypoint; import from `core`, `auth`,
`data`, `api`, `admin`, or `ui` as appropriate.

Apply `migrations/0002_core.sql` and `migrations/0006_jobs.sql` after the authorization migration. The package exports `registerHealthcheck`, `updateHealthcheck`, `registerCircuitBreaker`, `setCircuitBreaker`, `evaluateCircuitBreaker`, and generic job lifecycle helpers from `/cf-genai-base`. Healthchecks use `red`, `yellow` (unknown/transient), or `green`; breakers use `off`, `tripped`, or `on`, with `any` or `all` healthcheck evaluation. Automated evaluation may only move `on` to `tripped`, or self-healing `tripped` to `on`; admin API writes are the human control plane for the `off` state.

Admin APIs are `GET /api/admin/healthchecks`, `PUT /api/admin/healthchecks/:id`, `GET /api/admin/circuit-breakers`, `GET|PUT /api/admin/circuit-breakers/:id`, and `GET /api/admin/features`. React platform components consume these JSON responses. The catalog lists each installed runtime feature, its `packageName` and `version`, its most severe healthcheck state, all feature healthchecks, and its circuit breakers (including the feature roll-up breaker). Feature manifests may expose `healthchecks` and `circuitBreakers`; add `displayName`, `packageName`, and `version` to make the installation identity explicit. Use `createD1(env, { who })` for downstream D1 calls; it emits EventLog and AuditLog console records with the requesting actor.


## User administration

Apply `migrations/0004_tenants.sql` after the authorization migration to add
tenant membership and subscriptions. It creates the `Easley Family` tenant,
the `VIP` subscription, associates them, migrates all existing users into the
tenant, and keeps newly provisioned users attached to it.

Use the selected D1 target (local by default) to inspect and update users:

    cf-genai user list --target local
    cf-genai user get someone.com --target staging
    cf-genai user update someone.com --roles admin --target production

`user:get` also reports scopes, groups, and tenant memberships. The shared admin user page displays each user’s tenant memberships and lets an administrator attach or detach tenants. The admin API exposes `GET|POST /api/admin/tenants`, `GET|PUT /api/admin/tenants/:id`, and `GET|PUT /api/admin/users/:id/tenants`. Production commands should be run through the repository credentials wrapper and reviewed as an administrative change.

## Scoped data access

Features may register D1 resources with `dataResources` and receive the
scoped reader on the request state as `state.data`. Resources declare `user`,
`tenant`, `public`, or `system` scope, their physical table, and an explicit column
allowlist. Use `state.data.tenant`, `state.data.public`, `state.data.user`, or
`state.data.system`;
the reader applies ownership predicates, supports bounded native pagination via
page with limit/offset, count, and safe bulk updateWhere/deleteWhere
operations, and never accepts raw SQL. Resources can explicitly restrict
their operations to read, create, update, and delete.

Anonymous tenant reads require both publicTenantId on createWorker and a
resource-level publicRead declaration. Use publicRead true only when the
whole resource is public; for opt-in rows use a publicRead column/value
declaration such as visibility=public. Anonymous reads never grant anonymous
system access. A `public` resource is read-only and always predicates on the
worker's `publicTenantId`, including authenticated users; use it for shared
catalog data such as GTA's `gta-public` tenant.

Applications may pass subscriptionManifest to createWorker to register their
own subscription IDs and entitlement values. Base exposes
requireSubscription and requireEntitlement but does not know any
product-specific subscription such as VIP. Authenticated users can inspect
their validated active tenant at GET /api/tenant.

Administrators can start a short-lived, HttpOnly impersonation session with
POST /api/admin/users/:id/impersonate and clear it with
POST /api/admin/impersonate/clear. Impersonation affects scoped data context
only and does not grant the target user administrator permissions.

For example, a tenant-owned resource registers its `tenant_id` column with
base, while feature code calls `state.data.tenant.list("recipes")` without
passing a tenant ID. The active tenant must be a validated membership. A
resource used with the wrong scope returns no rows; writes fail closed.

Applications using scoped data must stop passing unrestricted `env.DB` to
domain features. Their migrations still add and backfill ownership columns,
and their resources must be registered with base.

Request handlers receive a request-scoped environment containing `data`,
`user`, `authUser`, `userId`, `context`, `event`, and an audited D1 binding.
Call `await env.event("thing.happened", "domain", details)` to emit a
normalized event. Features may provide `eventHandler(event, { env, ctx })`;
this is the extension point for feature integrations.

Long-running features can call `dispatchJob` with a Cloudflare Workflow binding;
base creates the durable record first and passes its ID to the Workflow as
`params.jobId`. Workflow code calls `executeJob`, which supplies a progress
reporter and completes or fails the record. `runJob` is the same lifecycle for
work already executing in the current invocation. Lower-level features may call
`createJob`, `startJob`, `updateJobProgress`, `completeJob`, `failJob`, and
`cancelJob` directly. Every lifecycle change is stored in `core_job_events` and emitted
to the owning user's live event room. Configure the optional live transport by
exporting `EventHub` from `@agilesyndrome/cf-genai-base/event-hub` and binding
an `EVENT_HUB` Durable Object in the application Worker. The React package's
`LiveEventsProvider`, `useJob`, `useJobs`, and `JobNotificationList` handle
reconnects and refreshes; the feature remains responsible for its own Workflow,
job type, executor, and result UI.

The exported `Event`, `emitEvent`, `requestContext`, `userId`, `sameOrigin`,
`readJson`, `secureJson`, `featureCircuit`, and `requireFeatureCircuit` helpers
are the shared identity, request, security, and feature-gating contracts.

The layered web surface is React-first: `/api` exports route contracts, scoped
repositories, the browser `apiFetch`/`apiJson` client, and job/event endpoints;
`/ui` exports React admin primitives, live event hooks, and durable job
notifications. Repositories are registered with
`createWorker({ repositories })`, can be supplied by applications or features,
and may declare links to other repositories while remaining behind the scoped
data reader. `GET /api/jobs` and `GET /api/jobs/:id` expose an authenticated
user's durable job records. `GET /api/events` upgrades to the authenticated live
event stream when the optional `EVENT_HUB` Durable Object binding is configured.
