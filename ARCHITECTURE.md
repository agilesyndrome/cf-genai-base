# Architecture

cf-genai-base is the shared Worker runtime and security boundary. It owns edge lifecycle concerns, reserved admin routes, strategy-driven admin authentication, authorization hooks, and optional feature composition.

## Runtime model

createWorker builds an ordered middleware chain:

1. the base admin boundary;
2. feature middleware, in declaration order;
3. direct middleware entries;
4. the legacy auth compatibility hook, when supplied;
5. the site fetch handler.

Each request receives an isolated state object. Middleware can return a response
or call next(). The base owns the health endpoint, exception boundary, security headers, admin authentication and authorization, optional boot validation, and scheduled handler exposure. Sites continue to own routing, HTML, D1 queries, R2 object keys, and domain-specific policies.

The base uses Cloudflare in-process bindings and does not retain request state
in module scope. Background work is scheduled through ctx.waitUntil.

## Repository layout

- src/index.js: public package surface only.
- src/runtime/: Worker composition, health/boot helpers, and feature registration.
- src/core/: event contracts, request identity, security responses, audited D1,
  and feature circuits.
- src/auth/: authorization users, scopes, tenants, groups, subscriptions, and
  impersonation.
- src/api/: route contracts, browser API client, and API test assertions.
- src/admin/: platform admin middleware, catalog rendering, navigation, and
  page helpers.
- src/ui/: browser components grouped into access controls, catalogs, styles,
  and groups.
- src/core/index.js, src/auth/index.js, and src/data/index.js: canonical
  entrypoints for the package's core, authentication, and data modules.
- CONTRACT.md: shared site and feature contract.
- README.md: integration examples.
- @agilesyndrome/cf-genai-cli: shared local project and release lifecycle.
- .github/workflows/publish.yml: tag-driven npm Trusted Publishing.

## Build and release

    npx --yes @agilesyndrome/cf-genai-cli@0.1.3 ci
    npx --yes @agilesyndrome/cf-genai-cli@0.1.3 release

The CLI release command pushes the version tag to GitHub; the publish workflow
verifies the package and publishes it to npm with provenance. It does not
publish from a developer laptop.

The release order is base first, then dependent feature packages such as auth.

The browser UI surface is exported separately from the Worker runtime so it can
be bundled into server-rendered or static applications without importing DOM
code into the Worker.
