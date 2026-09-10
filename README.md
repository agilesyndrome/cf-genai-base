# `@agilesyndrome/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The base is deliberately small: a site still owns its router, HTML, D1
queries, R2 keys, and scheduled jobs. `createWorker` composes ordered feature middleware, normalizes uncaught failures, and applies baseline response headers.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

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
