# `@agilesyndrome/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The base owns the shared security boundary as well as Worker lifecycle concerns. It reserves `/admin` and `/api/admin` routes, authenticates them using `AUTH_STRATEGY` (default `http_basic`, or `oauth` when an auth provider is supplied), and applies the optional `authorize` policy. Sites still own their router, HTML, D1 queries, R2 keys, and scheduled jobs.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

Base also provides provider-neutral authorization helpers and browser components
through `@agilesyndrome/cf-genai-base/authorization` and
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

## Shared platform helpers

`createWorker` can own `/health` and `/api/health`, run a boot validator before
requests, and optionally deliver server-side PostHog events. Use
`assertBoot(env, { bindings: ["DB"], required: ["AUTH_SESSION_SECRET"] })` in a
site initializer to fail closed when its Cloudflare configuration is incomplete.


## Core operational services

Apply `migrations/0002_core.sql` after the authorization migration. The package exports `registerHealthcheck`, `updateHealthcheck`, `registerCircuitBreaker`, `setCircuitBreaker`, and `evaluateCircuitBreaker` from `/cf-genai-base`. Healthchecks use `red`, `yellow` (unknown/transient), or `green`; breakers use `off`, `tripped`, or `on`, with `any` or `all` healthcheck evaluation. Automated evaluation may only move `on` to `tripped`, or self-healing `tripped` to `on`; admin API writes are the human control plane for the `off` state.

Admin APIs are `GET /api/admin/healthchecks`, `PUT /api/admin/healthchecks/:id`, `GET /api/admin/circuit-breakers`, `GET|PUT /api/admin/circuit-breakers/:id`. Feature manifests may expose `healthchecks` and `circuitBreakers`. Use `createD1(env, { who })` for downstream D1 calls; it emits EventLog and AuditLog console records with the requesting actor.


## User administration

Use the selected D1 target (local by default) to inspect and update users:

    cf-genai user list --target local
    cf-genai user get someone.com --target staging
    cf-genai user update someone.com --roles admin --target production

`user:get` also reports scopes and groups. The user update command resolves an email, subject, or internal id and supports `admin` or `none` roles. Production commands should be run through the repository credentials wrapper and reviewed as an administrative change.
