# `@easleyowl/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The base is deliberately small: a site still owns its router, HTML, D1
queries, R2 keys, and scheduled jobs. `createWorker` composes an optional auth
handler, normalizes uncaught failures, and applies baseline response headers.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

```js
import { createWorker, healthResponse } from "@easleyowl/cf-genai-base";

export default createWorker({
  auth: (request, env) => auth.handle(request, env),
  fetch: async (request, env) => {
    if (new URL(request.url).pathname === "/health") return healthResponse(env);
    return router(request, env);
  },
});
```
