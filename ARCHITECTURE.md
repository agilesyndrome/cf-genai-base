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
or call next(). The base owns the health endpoint, exception boundary, security headers, admin authentication and authorization, optional boot validation, scheduled handler exposure, and metrics hooks. Sites continue to own routing, HTML, D1 queries, R2 object keys, and domain-specific policies.

The base uses Cloudflare in-process bindings and does not retain request state
in module scope. Background metrics work is scheduled through ctx.waitUntil.

## Repository layout

- src/index.js: public Worker composition API.
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
