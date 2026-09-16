# Changelog

## 5.0.0

- Replace `@agilesyndrome/cf-genai-base/authorization` imports with `/auth`.
- Replace direct `src/core.js` imports with `src/core/index.js` or the package `/core` entrypoint.
- Replace direct `src/data.js` imports with `src/data/index.js` or the package `/data` entrypoint.
- Replace direct `src/api/router.js` imports with `src/api/contracts.js` for route definitions and dispatch.
- Update internal imports to the canonical folder modules; the old facade files are removed.
- Update package consumers and lockfiles to version `5.0.0`.
- Replace server-rendered admin HTML and custom elements with the React UI entrypoint; apps own the shell and theme around base's admin components.
- Apply `migrations/0006_jobs.sql`; features now use generic durable job helpers and `GET /api/jobs` instead of inventing job tables and status endpoints.
- Configure an `EVENT_HUB` Durable Object and export `EventHub` from `@agilesyndrome/cf-genai-base/event-hub` to enable authenticated live job events over WebSockets.
- Dispatch long-running work through a Cloudflare Workflow with `dispatchJob`; execute its durable lifecycle with `executeJob` instead of relying on request-lifetime background work.
- Remove the lowercase `admin_token` environment alias; use `ADMIN_TOKEN` only.
