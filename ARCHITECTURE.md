# Architecture

cf-genai-base is the shared Worker runtime and security boundary. It owns edge lifecycle concerns, reserved admin routes, strategy-driven admin authentication, authorization hooks, and optional feature composition.

## Runtime model

createWorker builds an ordered middleware chain:

1. the base admin boundary;
2. the Hono domain-route dispatcher;
3. feature middleware, in declaration order;
4. direct middleware entries;
5. the site fetch handler.

Each request receives an isolated state object. Middleware can return a response
or call next(). The base owns the health endpoint, exception boundary, security headers, admin authentication and authorization, optional boot validation, and scheduled handler exposure. Sites continue to own routing, HTML, D1 queries, R2 object keys, and domain-specific policies.

The base uses Cloudflare in-process bindings and does not retain request state
in module scope. Background work is scheduled through ctx.waitUntil.

## Repository layout

- src/index.ts: public package surface only.
- src/runtime/: Worker composition, health/boot helpers, and feature registration.
  `model.ts` is the shared extension contract for Worker bindings, per-request
  state, middleware, features, and application handlers.
- src/features/: opt-in first-party capabilities. Each feature owns a folder
  with a small TypeScript `index.ts` package entrypoint and focused implementation files.
  `llm/` separates its client, configuration, schema validation, errors, and
  feature manifest; `messaging/` separates models, resources, storage, jobs,
  and its feature manifest. Shipping their code does not activate them.
- src/core/circuits/: feature availability and circuit-breaker persistence.
- src/core/healthchecks/: healthcheck persistence and feature health catalogs.
- src/core/events/: event contracts, publishing, audit logs, and the EventHub
  Durable Object.
- src/core/jobs/: generic durable job lifecycle and job events.
- src/core/database/: audited D1 access.
- src/core/security/: HTTP input validation and secure responses.
- src/auth/identity/: canonical request identity and actor context.
- src/auth/: authorization users, scopes, tenants, groups, subscriptions,
  impersonation, and identity.
- src/api/: route contracts, browser API client, and API test assertions.
- src/admin/: platform admin middleware and JSON APIs.
- src/ui/react/: React admin components, live event hooks, and durable job
  notifications. Applications own the shell and theme around these primitives.
- src/cli/ and bin/cf-genai.js: project automation, D1 operations, and the
  administrative command line. The CLI is released with base so its command
  surface always matches the platform services in the same package version.
- src/core/index.ts, src/auth/index.ts, and src/data/index.ts: broad public
  entrypoints. Internal modules import the narrow segment that owns a symbol;
  package consumers can do the same through `/core/circuits`,
  `/core/healthchecks`, `/core/events`, `/core/jobs`, `/core/database`,
  `/core/security`, and `/auth/identity`.
- CONTRACT.md: shared site and feature contract.
- README.md: integration examples.
- CLI.md: complete operational command and safety documentation.
- .github/workflows/publish.yml: tag-driven npm Trusted Publishing.

## Build and release

    node bin/cf-genai.js ci
    npx --yes @agilesyndrome/cf-genai-base release --confirm

The source tree intentionally supports a deployable JavaScript/TypeScript
hybrid while modules are migrated. `allowJs` remains enabled, strict checking
applies to TypeScript modules, and both languages compile into `dist/` with
declaration files and source maps. Source imports keep `.js` specifiers so the
emitted Node ESM package is valid whether the source module is currently
`.js`, `.jsx`, `.ts`, or `.tsx`.

Package exports and the published CLI resolve compiled files from `dist/`.
Tests run against the mixed source tree with the TypeScript loader; the build
then smoke-tests every static package export before inspecting the npm tarball.
This makes each small conversion batch independently releasable. `allowJs`
can be removed only after the final JavaScript module has been migrated.

The CLI release command pushes the version tag to GitHub; the publish workflow
verifies the package and publishes it to npm with provenance. It does not
publish from a developer laptop.

LLM and messaging release with base. External features such as auth can retain
their own release cadence while composing through the same feature contract.

The React UI surface is exported separately from the Worker runtime so it can
be bundled into a Vite browser application without importing React or DOM code
into the Worker. The Worker exposes JSON admin APIs, durable job records, and
an optional Durable Object-backed live event stream.

## Segment boundaries

Each segment owns one operational concern and exposes it from that segment's
index module. Implementation code imports the narrow owning segment rather than
`src/core/index.ts`; the broad barrel is reserved for the public package
surface. Cross-segment dependencies point toward lower-level services:
database and events are infrastructure, healthchecks may use circuits, and
runtime composition may use all segments. Segments do not reach into runtime,
admin, UI, or application code.

This keeps feature work local: circuit policy changes stay in `circuits/`,
health aggregation stays in `healthchecks/`, identity changes stay in
`auth/identity/`, and job lifecycle changes stay in `jobs/`. Built-in feature
work follows the same rule: code specific to an LLM or messaging concern stays
inside that feature's folder and is exposed deliberately from its `index.ts`.

## Application domains

`AppDomain<Model, Env, State>` is the reusable boundary for a business concept.
A domain owns its API route declarations, access defaults, custom policies, and
named server views; its folder owns the model, validation, service, and D1 code.
Administrative access is one available policy, not a directory or inheritance
requirement.

`defineApp` returns an immutable manifest and preserves the inferred feature and
domain types in its public declaration. `defineFeature` likewise narrows its
options from the built-in feature name. This makes the manifest the stable App
SDK boundary: callers compose capabilities once, and the runtime consumes a
snapshot that cannot drift when the caller later mutates its input arrays.

```ts
import { AppDomain, defineApp } from "@agilesyndrome/cf-genai-base";

class RecipesDomain extends AppDomain<Recipe, Env, RequestState> {
  constructor() {
    super({ name: "cookbook.recipes", basePath: "/api/recipes", auth: "user" });
    this.route({
      method: "GET",
      path: "/:recipeId",
      scopes: "recipes:read",
      handler: ({ env, params }) => getRecipe(env, params.recipeId),
    });
    this.view("detail", RecipeView);
  }
}

export default defineApp({ name: "cookbook", domains: [new RecipesDomain()] });
```

Routes may be public, user-authenticated, administrator-only, scoped with
all/any semantics, or guarded by an asynchronous custom policy. `createWorker`
collects platform, application, and feature domains and gives their routes to
the shared Hono dispatcher.

Reusable UI domains use `list`, `detail`, `create`, and `edit` as conventional
view names, omitting views that do not fit the domain lifecycle. Runtime-owned
records such as jobs, healthchecks, and circuit breakers expose commands and
state transitions rather than artificial delete/create forms.
