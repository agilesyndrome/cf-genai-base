# Architecture

cf-genai-base is the small Worker runtime layer shared by the sites. It owns
edge lifecycle concerns and composes site code with optional feature modules.

## Runtime model

createWorker builds an ordered middleware chain:

1. feature middleware, in declaration order;
2. direct middleware entries;
3. the legacy auth compatibility hook, when supplied;
4. the site fetch handler.

Each request receives an isolated state object. Middleware can return a response
or call next(). The base owns the health endpoint, exception boundary, security
headers, optional boot validation, scheduled handler exposure, and metrics
hooks. Sites continue to own routing, HTML, D1 queries, R2 object keys, and
domain authorization.

The base uses Cloudflare in-process bindings and does not retain request state
in module scope. Background metrics work is scheduled through ctx.waitUntil.

## Repository layout

- src/index.js: public Worker composition API.
- CONTRACT.md: shared site and feature contract.
- README.md: integration examples.
- Makefile: test/build/release lifecycle.
- .github/workflows/publish.yml: tag-driven npm Trusted Publishing.

## Build and release

    make test
    make build
    make bump
    make publish
    make wait

make publish pushes the version tag to GitHub; the publish workflow verifies
the package and publishes it to npm with provenance. It does not publish from a
developer laptop. make wait handles npm registry propagation before consumers
regenerate lockfiles.

The release order is base first, then dependent feature packages such as auth.

make status reports the exact npm version, matching Git tag, latest publish
workflow result via gh, and local branch cleanliness/upstream alignment. It is
read-only and may show WAIT/WARN for an unpublished template or unavailable
external service.
