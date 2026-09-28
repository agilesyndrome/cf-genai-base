# `@agilesyndrome/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The package also ships the `cf-genai` command. Runtime, administration, D1,
project automation, and release tooling are versioned and published together;
there is no separate CLI dependency.

The base owns the shared security boundary as well as Worker lifecycle concerns. It reserves `/admin` and `/api/admin` routes, authenticates them using `AUTH_STRATEGY` (default `http_basic`, or `oauth` when an auth provider is supplied), and applies the optional `authorize` policy. Sites still own their router, HTML, D1 queries, R2 keys, and scheduled jobs.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

The Worker transport is built on [Hono](https://hono.dev/): middleware ordering,
HTTP method/path matching, and admin/API dispatch all use Hono's runtime. Existing
feature middleware keeps the package's compatibility signature while new integrations
can use Hono middleware directly. For Worker-rendered documents, import
`createSsrRenderer`, `SiteDocument`, or `renderSiteDocument` from
`@agilesyndrome/cf-genai-base/ui/ssr`; the interactive admin components remain
React-based and are intentionally separate from Hono JSX SSR.

The site document contract owns safe metadata, canonical URLs, Open Graph
fields, theme color, stylesheets, scripts, and body data attributes. A site
supplies its own children, theme CSS, navigation, and content components.

Base also provides provider-neutral authorization helpers and browser components
through `@agilesyndrome/cf-genai-base/auth` and
`@agilesyndrome/cf-genai-base/ui`. Applications declare their scope manifest,
while base owns the user, scope, and grant records plus the generic user-access
API. The UI components are themeable with CSS custom properties and do not
contain application-specific components.

```js
import { createWorker, defineApp, defineFeature } from "@agilesyndrome/cf-genai-base";

export default createWorker({
  app: defineApp({
    name: "cookbook",
    features: [
      auth,
      defineFeature("llm", { apiToken: (env) => env.LLM_API_TOKEN }),
      defineFeature("messaging", { displayName: "Cookbook chat" }),
    ],
  }),
  fetch: async (request, env) => {
    return router(request, env);
  },
});
```

Built-in features are inert unless an application registers them in
`app.features`. Feature-specific APIs use explicit subpaths:

```js
import { createLLM } from "@agilesyndrome/cf-genai-base/features/llm";
import { createMessagingStore } from "@agilesyndrome/cf-genai-base/features/messaging";
```

The LLM feature provides OpenAI-compatible generation, typed JSON repair,
review, model healthchecks, circuit breakers, and durable job integration. The
`/features/llm` entrypoint exports its complete TypeScript contract, including
`LLMEnvironment`, client and request options, provider configuration, JSON
Schema inputs and `InferJSONSchema`, token usage, generation/review inputs,
job options, loggers, and callbacks. Pass a literal schema with `as const` (or
`satisfies JSONSchemaInput`) to preserve the generated value type.
The messaging feature provides conversations, participants, messages, scoped and
tenant-isolated stores, and durable reply jobs. Construct the store with the
request-scoped reader, for example `createMessagingStore(env.data.tenant)`. Apply
`migrations/0007_messaging.sql` when messaging is requested.

Features expose `middleware(request, env, ctx, next, state)` and may
short-circuit routes, attach request state, or call `next()`.

Base protects `/admin` and `/api/admin`; the React UI package owns the browser
pages. For a complete single-route UI, import `AdminDashboard` from
`@agilesyndrome/cf-genai-base/ui` and mount `<AdminDashboard />`, or use
`mountAdminDashboards` for declarative roots. It includes
users and access assignments, tenants, user groups, scopes, subscriptions,
jobs, features, health checks, and circuit breakers with internal list/detail
navigation. Use `enabledSections` to hide an unavailable optional domain and
`applicationSections` to add site-owned panels. Import `AdminShell` and the platform catalogs from
`@agilesyndrome/cf-genai-base/ui`. Sites provide their own application links and
theme while the base components consume the shared JSON admin APIs.

```jsx
import { AdminDashboard } from "@agilesyndrome/cf-genai-base/ui";
import "@agilesyndrome/cf-genai-base/ui/styles.css";

export function AdminPage() {
  return <AdminDashboard />;
}
```

## Command-line tools

Install base in a project (or globally) and use the bundled executable:

```sh
npm install @agilesyndrome/cf-genai-base
npx cf-genai version

cf-genai check
cf-genai test
cf-genai ci
cf-genai dev
cf-genai storybook
cf-genai upgrade base latest
cf-genai release --confirm
cf-genai release-status --wait 3
```

The CLI includes project checks and releases, scoped-data linting, package
upgrades with migration vendoring, D1 refresh/backup/restore/migration, site
status, and user, tenant, healthcheck, circuit-breaker, and platform admin
operations.

In this repository, `npm install` activates the checked-in Git hooks. Each
commit runs `cf-genai ci`, the same full verification command used by GitHub
Actions. Verification includes typechecking, source whitespace/unsafe-type
checks, compilation, unit tests, the example integration suite, export checks,
and package assembly.

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
`core` owns operational primitives, `auth` owns identity and authorization,
`api` owns route contracts and the browser client, `admin` owns platform
administration, and `ui` owns shared browser components. Core services have
focused package entrypoints: `/core/circuits`, `/core/healthchecks`,
`/core/events`, `/core/jobs`, `/core/database`, and `/core/security`; request
identity is `/auth/identity`. Prefer these narrow imports when an app needs one
concern. The root package remains the application-composition surface.

Apply `migrations/0002_core.sql` and `migrations/0006_jobs.sql` after the authorization migration. The package exports `registerHealthcheck`, `updateHealthcheck`, `registerCircuitBreaker`, `setCircuitBreaker`, `evaluateCircuitBreaker`, and generic job lifecycle helpers from `/cf-genai-base`. Healthchecks use `red`, `yellow` (unknown/transient), or `green`; breakers use `off`, `tripped`, or `on`, with `any` or `all` healthcheck evaluation. Automated evaluation may only move `on` to `tripped`, or self-healing `tripped` to `on`; admin API writes are the human control plane for the `off` state.

Admin APIs are `GET /api/admin/healthchecks`, `GET|PUT /api/admin/healthchecks/:id`, `GET /api/admin/circuit-breakers`, `GET|PUT /api/admin/circuit-breakers/:id`, and `GET /api/admin/features`. Reads require `operations:read`; mutations require `operations:manage`, while platform administrators bypass capability checks. React platform components provide both catalog and detail views. The catalog lists each installed runtime feature, its `packageName` and `version`, its most severe healthcheck state, all feature healthchecks, and its circuit breakers. Use `createD1(env, { who })` for downstream D1 calls; it emits EventLog and AuditLog records with the requesting actor.


## User administration

Apply `migrations/0004_tenants.sql` after the authorization migration to add
tenant membership and subscriptions. It creates the `Easley Family` tenant,
the `VIP` subscription, associates them, migrates all existing users into the
tenant, and keeps newly provisioned users attached to it.

Use the selected D1 target (local by default) to inspect and update users:

    cf-genai user list --target local
    cf-genai user get someone.com --target staging
    cf-genai user update someone.com --roles admin --target production

`user:get` also reports scopes, groups, and tenant memberships. The shared admin UI provides list and detail views and atomically replaces a user’s complete access assignment through `PUT /api/admin/users/:id/access`; individual relationship endpoints remain available. The admin API also exposes `GET /api/admin/users/:id`, `GET|POST /api/admin/tenants`, and `GET|PUT|PATCH|DELETE /api/admin/tenants/:id`. The default tenant cannot be deleted, and other tenants must first have no users, subscriptions, or messaging conversations. Tenant deletion also requires an `X-Confirm-Delete` header equal to the tenant ID. Production commands should be run through the repository credentials wrapper and reviewed as an administrative change.

## Scoped data access

### Versioned data objects

Sites can opt a tenant-owned object into immutable content revisions and explicit
publication. Apply `migrations/0011_versioned_objects.sql` through the site's
normal D1 migration process, then register a managed domain:

```ts
import { createWorker, defineApp, VersionedObjectDomain } from "@agilesyndrome/cf-genai-base";

const recipes = new VersionedObjectDomain({
  name: "recipes",
  basePath: "/api/recipes",
  fields: { title: "string", servings: "number", vegetarian: "boolean" },
  publicRead: true,
  writeScope: "recipes:write",
  publishScope: "recipes:publish",
  passport: { maximum: "public", default: "private", userChoice: true },
  ratings: {
    scale: ["yuck", "meh", "loved", "omg yum yum"],
    maximum: "tenant", default: "private", userChoice: true,
  },
});

export default createWorker({
  app: defineApp({ name: "cookbook", domains: [recipes] }),
  publicTenantId: "easley-family",
  fetch: () => new Response("Not found", { status: 404 }),
});
```

The domain provides `GET|POST /api/recipes`, `GET|PUT /api/recipes/:id`,
`GET /api/recipes/:id/draft`, `GET /api/recipes/:id/versions`, and
`POST|DELETE /api/recipes/:id/publish`. Create accepts `{ "content": {...} }`;
save accepts `{ "expectedRevision": 1, "content": {...} }`; publish accepts
`{ "revision": 1 }`. Public reads see only the chosen published revision, while
signed-in tenant members can inspect the latest draft and history. Repeated saves
require the current revision and return 409 on conflict. All writes are tenant
scoped and use the managed service; do not register the shared object tables as
generic writable resources. This object model supports scalar fields and
tenant-owned objects. Workflow, places, and photos are separate future work.

With passport enabled, `PUT|GET /api/recipes/:id/passport` writes or reads the
caller's stamp, `GET /api/recipes/passport` lists the caller's stamps, and
`GET /api/recipes/:id/passports` lists visible stamps. Ratings add
`POST|GET /api/recipes/:id/ratings`. Rating accepts
`{ "value": "loved", "visibility": "tenant" }`; it creates a private passport
if needed and appends an event linked to the currently published revision.
The caller's passport detail includes their rating history. Ratings can be
enabled without an explicit passport configuration; this creates a private
passport automatically. Multiple ratings never replace earlier events.

Each passport and rating policy has a maximum visibility (`private`, `tenant`,
or `public`), a default, an optional `userChoice`, and an optional capability
`scope` for writes. Per-record visibility cannot exceed the site's maximum;
ratings and stamps may have separate policies. Public sharing also requires
`publicRead: true`. Public/tenant list endpoints check the published object
and filter hidden rows before returning them; users can always see their own
stamps and ratings through their personal endpoint. Apply
`migrations/0012_object_engagement.sql` when enabling these mix-ins.
Engagement lists return up to 100 rows and accept `?offset=100` for the next page.

For anonymous reads, configure `publicTenantId` and `publicRead: true`. Grant
the declared write and publish scopes through the normal authorization system.
The domain itself supplies routes and validation; sites do not need to write
their own SQL or CRUD handlers for these objects.

Domains may register D1 resources with `dataResources` and receive the
scoped reader on the request state as `state.data`. Resources declare `user`,
`tenant`, `public`, or `system` scope, their physical table, and an explicit column
allowlist. Use `state.data.tenant`, `state.data.public`, `state.data.user`, or
`state.data.system`;
the reader applies ownership predicates, supports bounded native pagination via
page with limit/offset, count, and safe bulk updateWhere/deleteWhere
operations, and never accepts raw SQL. Resources can explicitly restrict
their operations to read, create, update, and delete, require capabilities per
operation with `operationScopes`, and protect columns with `columnScopes`.

Anonymous tenant reads require both publicTenantId on createWorker and a
resource-level publicRead declaration. Use publicRead true only when the
whole resource is public; for opt-in rows use a publicRead column/value
declaration such as visibility=public. Anonymous reads never grant anonymous
system access. A `public` resource is read-only and always predicates on the
worker's `publicTenantId`, including authenticated users; use it for shared
catalog data such as GTA's `gta-public` tenant.

Applications register `new AuthSubscriptionsDomain(manifest)` in
`defineApp({ domains })` to own their subscription IDs and entitlement values.
That domain exposes catalog/detail APIs at `/api/admin/subscriptions` and tenant
assignment at `/api/admin/tenants/:id/subscriptions`. Base also exposes
requireSubscription and requireEntitlement but does not know any
product-specific subscription such as VIP. Authenticated users can inspect
their validated active tenant at GET /api/tenant.

Administrators can start a short-lived, HttpOnly impersonation session with
POST /api/admin/users/:id/impersonate and clear it with
POST /api/admin/impersonate/clear. Impersonation affects scoped data context
only and does not grant the target user administrator permissions.

The messaging store derives user senders from the scoped reader context and
limits conversations to their creator, participants, and system actors.
Creator-only operations manage participants, titles, messages, and deletion.
Trusted host adapters without an actor context remain responsible for their
own authorization.

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
notifications. Repositories are registered by `AppDomain` instances in
`defineApp({ domains })` or `feature.domains`; they may declare links to other
repositories while remaining behind the scoped data reader. `GET /api/jobs`
and `GET /api/jobs/:id` expose an authenticated
user's durable job records. `GET /api/events` upgrades to the authenticated live
event stream when the optional `EVENT_HUB` Durable Object binding is configured.
