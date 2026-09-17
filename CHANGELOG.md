# Changelog

## 5.0.3

This release intentionally removes legacy compatibility paths. Applications
must migrate to the single v5 contract; no aliases or fallback behavior are
retained.

### Consolidation

- `cf-genai-llm`, `cf-genai-messaging`, and `cf-genai-cli` are no longer
  runtime dependencies. LLM and messaging now ship from
  `@agilesyndrome/cf-genai-base/features/llm` and `/features/messaging`; the
  `cf-genai` executable ships from base.
- Messaging storage is now base migration `0007_messaging.sql`. Vendor and
  apply the base migrations, then remove separately vendored messaging schema
  migrations when they are redundant for a new installation.
- Messaging tables and the built-in resource manifest are tenant-scoped by
  default. Remove application-owned messaging resource declarations; existing
  installations must add and backfill `tenant_id` before adopting the base
  migration contract.
- The changelog filename is now `CHANGELOG.md`.
- Core operational code is divided into owned segments: `circuits/`,
  `healthchecks/`, `events/`, `jobs/`, `database/`, and `security/`. Request
  identity now lives under `auth/identity/`. Internal modules use these narrow
  boundaries instead of the broad core barrel.
- Built-in features now use folder entrypoints. LLM code is divided into
  client, configuration, schema, error, and manifest modules under
  `features/llm/`; messaging code is divided into model, resource, store, job,
  and manifest modules under `features/messaging/`.

### Required application changes

- Replace imports of removed flat source modules with package segment exports:
  `core/circuits.js` becomes `/core/circuits`, `core/events.js` becomes
  `/core/events`, `core/jobs.js` becomes `/core/jobs`, `core/d1.js` becomes
  `/core/database`, `core/security.js` becomes `/core/security`, and
  `core/identity.js` becomes `/auth/identity`. The old source files and their
  compatibility facades do not exist in v5.
- Replace direct source imports of `src/features/llm.js` and
  `src/features/messaging.js` with their folder `index.js` files. Package
  consumers continue to use `/features/llm` and `/features/messaging`; those
  package paths now resolve to the folder entrypoints.

- Move every feature registration into `defineApp({ features: [...] })`.
  Remove `createWorker.features` and `createWorker.featureOptions`. Configure a
  built-in with `defineFeature("llm", options)` or
  `defineFeature("messaging", options)`; put external feature objects such as
  auth directly in the same application feature array.
- Remove `createWorker.auth` and `createWorker.repositories`. Register auth as
  an application feature and repositories through `defineApp({ repositories })`.
- Replace `createFeature` imports with `createLLMFeature` or
  `createMessagingFeature`. `createMessagingFeature` is no longer an alias.
- LLM clients expose only `generate`, `generateJob`, `generateMulti`, `review`,
  `reviewMulti`, and `listModels`. Remove the `*WithSchema` method aliases.
- Use the fixed LLM signatures `(prompt, schema, options)`,
  `(jobId, prompt, schema, options)`, and
  `(originalText, prompts, schema, options)`. Object-wrapped requests and
  schema-inside-options overloads are removed.
- Configure LLM credentials only with `apiToken` or `LLM_API_TOKEN`. Remove
  `apiKey`, `LLM_API_KEY`, and `OPENAI_API_KEY`. Use `featureName`; the old
  client `feature` option is removed.
- Messaging participants must be `{ type, key, name, metadata? }` objects.
  Remove string participants and the `participantType`, `participantKey`,
  `displayName`, `id`, `senderType`, `senderKey`, `senderName`, `recipients`,
  and `kind` input aliases. Reply generators must return a message object, not
  a string.
- Messaging stores now accept only a scoped data reader:
  `createMessagingStore(env.data.tenant)`. Remove raw D1 bindings, table
  prefixes, and authorization callbacks from store construction.
- Feature manifests now accept only `name`, `displayName`, `packageName`,
  `version`, `healthchecks`, and `circuitBreakers` in their canonical casing.
  Remove nested manifests, `id` names, snake-case manifest properties,
  `healthChecks`, `circuit_breakers`, and circuit `dependencies`.
- Configure both an exact HTTPS `OIDC_DISCOVERY_URL` and `OIDC_ISSUER`. The
  issuer-to-discovery fallback and automatic well-known URL construction are
  removed.
- Use only the CLI forms `healthchecks ...`, `circuit-breakers ...`, and
  `--env production`. Colon commands, singular domains, `circuit`, `update`
  action aliases, `rename`, and `prod` are removed. `cf-genai upgrade` accepts
  only `base` or `auth`; it no longer treats `llm` and `messaging` as aliases.
  Top-level `backup` and `restore` aliases are removed; use `d1 backup` and
  `d1 restore`.
- Read request IDs from the `X-Request-ID` response header. The browser client
  no longer falls back to a `request_id` JSON field.

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
