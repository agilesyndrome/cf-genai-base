- [:check: 2026-09-18 by Claude] [SEC-1] **CRITICAL — Public tenant reads also authorize anonymous writes.**
  - **Problem:** `isAllowed()` accepts `actor.public && resource.publicRead` for tenant operations without restricting it to reads.
  - **Why it matters:** A writable public-tenant resource with default operation scopes permits anonymous creation, modification, and deletion wherever an application exposes those operations through the data reader. Route-level authorization can mitigate this; the advertised data boundary itself fails.
  - **Evidence:** `src/data/policy.ts:17`, `src/data/resources.ts`, `src/data/context.ts:38`, and write methods in `src/data/reader.ts`. An in-memory SQLite reproduction with `publicRead: true`, writable columns, and an anonymous public-tenant context successfully inserted and deleted records.
  - **Proposed solution:** Make public access read-only independently of resource writability; require an authenticated actor for every non-system mutation.
  - **Implementation:** Fix the tenant branch in `isAllowed()` while retaining tenant/visibility predicates. Extend `tests/data.test.mjs` to reject anonymous insert, update, delete, updateWhere, and deleteWhere for both supported public-read configurations.

- [:check: 2026-09-18 by Claude] [SEC-2] **CRITICAL — Domain routes bypass configured authentication and policy middleware.**
  - **Problem:** The domain dispatcher returns matched responses before feature middleware and application middleware execute. Domain routes also default to public access.
  - **Why it matters:** Applications relying on `createAuth()` protection, its authorization/origin checks, or global deny/maintenance middleware leave matching domain endpoints outside those policies. Explicit route authentication does not restore skipped global policies.
  - **Evidence:** `src/runtime/worker.ts:107`, `src/domain/app-domain.ts:52`, and `src/auth/oauth-single/index.ts:190`. A default-public domain endpoint with `createAuth()` and deny-all application middleware returned anonymous HTTP 200; the application middleware ran zero times.
  - **Proposed solution:** Use one ordered request pipeline: identity resolution, global policy middleware, then domain dispatch and fallback handlers. Require explicit public-route declarations.
  - **Implementation:** Reorder/combine the runtime and domain Hono pipelines, explicitly exempt login/callback/public health endpoints, and retain route-specific scope checks. Test domain and fallback endpoints against OAuth authorization denial, origin rejection, and availability middleware.

- [:check: 2026-09-18 by Claude] [SEC-3] **HIGH — Scope discovery silently removes system-only protection.**
  - **Problem:** Registering route scope names normalizes them to `system: false`; the scope upsert overwrites existing protection metadata.
  - **Why it matters:** Previously unassignable system scopes become ordinary assignable grants. An unauthenticated admin-path request can trigger this mutation before authentication rejects it; subsequent assignment still requires a grant-management path or operator.
  - **Evidence:** `src/runtime/worker.ts:140` and `ensureScopeManifest()`, `src/auth/scopes/validation.ts:3`, `src/auth/scopes/d1.ts:14`. Reproduction: create a `system: true` scope, reference it in a domain, request `/api/admin/users` anonymously; response is 401, but the stored flag becomes zero and `replaceUserGrants()` accepts the scope.
  - **Proposed solution:** Separate scope-name discovery from authoritative metadata updates. Discovery must never downgrade existing metadata.
  - **Implementation:** Use conflict-do-nothing inserts for string registrations; require an explicit manifest operation to change protection flags. Move synchronization out of anonymous request handling. Test that protected scopes remain protected and unassignable after runtime initialization.

- [:check: 2026-09-18 by Claude] [SEC-4] **HIGH — Identity creation implicitly grants shared-tenant membership.**
  - **Problem:** Every newly persisted OIDC user is enrolled in the hard-coded default tenant; identity persistence doubles as tenant authorization.
  - **Why it matters:** Any user accepted by the configured provider joins the same tenant without an invitation or approval. Tenant resources without additional operation scopes become available to these users. Exposure depends on provider admission rules and what the application stores in that tenant.
  - **Evidence:** `src/auth/users/d1.ts:35` (`insertUserRow()` and `ensureDefaultTenantMembership()`), `src/auth/constants.ts`, and `migrations/0004_tenants.sql`. SQLite reproduction of `ensureUser()` for a new subject created membership in `easley-family`; `src/data/context.ts:64` automatically selects a sole membership.
  - **Proposed solution:** Separate login from enrollment. Default new identities to no tenant membership; grant membership through invitations or an explicit application onboarding policy.
  - **Implementation:** Remove automatic enrollment from user persistence. Make legacy single-tenant enrollment opt-in, avoid unconditional backfill for new installations, and audit existing memberships before selective remediation. Test that first login alone grants no tenant access.

- [:check: 2026-09-18 by Claude] [ARCH-5] **HIGH — Jobs have no enforceable lifecycle or exclusive execution claim.**
  - **Problem:** `executeJob()` unconditionally starts existing jobs, including cancelled or completed jobs. Updates use a read-then-write snapshot without a status/version condition; cancellation only changes a row.
  - **Why it matters:** Retries and competing workers can repeat paid model calls and message insertion. Cancelled work can execute, and stale progress updates can overwrite terminal state.
  - **Evidence:** `src/core/jobs/service.ts:15`, `:62`, and `:92`; `src/core/jobs/d1.ts:75`; cancellation in `src/core/jobs/domain.ts`; side effects in `src/features/messaging/jobs.ts`. SQLite reproduction: create, cancel, then execute twice produced two callback executions and final status `succeeded`.
  - **Proposed solution:** Enforce atomic state transitions and fenced execution attempts; make terminal states immutable and side effects idempotent by job ID.
  - **Implementation:** Claim queued jobs with conditional `UPDATE ... RETURNING`; introduce lease/attempt fencing for recoverable execution. Do not rewrite status during progress updates. Connect cancellation to Workflow termination/cooperative checks. Test concurrent claims, duplicate delivery, recovery, and cancellation during execution.

- [:check: 2026-09-18 by Claude] [ARCH-6] **HIGH — Response wrappers discard WebSocket upgrades.**
  - **Problem:** Both security decoration and request-ID decoration reconstruct responses without the Workers-specific `webSocket` handle.
  - **Why it matters:** EventHub upgrades cannot survive the complete Worker response path. Turning security off does not fix the request-ID wrapper.
  - **Evidence:** `src/core/events/hub.ts:36` creates the upgrade; `src/core/events/domain.ts` forwards it; `src/core/security/index.ts:130` and `src/runtime/worker.ts:228` discard its socket. A response-double reproduction confirmed handle loss with security enabled and disabled. Workers documents the required upgrade handle in its [Response API](https://developers.cloudflare.com/workers/runtime-apis/response/); this was not tested against live workerd.
  - **Proposed solution:** Preserve upgrade responses unchanged or explicitly carry their socket through every response decorator.
  - **Implementation:** Centralize response decoration with a WebSocket-aware branch. Add a real Workers integration test that authenticates, upgrades through `createWorker()`, and receives an event with security enabled and disabled.

- [:check: 2026-09-18 by Claude] [ARCH-7] **MEDIUM — Health registration is mistaken for ongoing health measurement.**
  - **Problem:** Registration executes live probes but caches their promise for the warm binding/feature set. The healthcheck upsert does not update existing state, and explicit health updates do not reevaluate dependent breakers.
  - **Why it matters:** Recorded health and circuit decisions can remain stale across outages and recovery; the operational control plane does not reliably reflect current dependencies.
  - **Evidence:** `src/core/healthchecks/features.ts:28`, `src/runtime/features.ts:28`, `src/core/healthchecks/d1.ts:17`, and `src/core/healthchecks/service.ts`. SQLite reproduction registered one check green, then red; its stored state remained green.
  - **Proposed solution:** Separate idempotent manifest registration from timestamped probe measurements and circuit evaluation.
  - **Implementation:** Keep registration cached, but run measurements on an explicit scheduled/TTL path that updates state and checked time. Reevaluate affected breakers after measurements and manual changes, preserving manual shutdowns. Test green→red→green transitions and stale-measurement behavior.

- [:check: 2026-09-18 by Claude] [SEC-8] **MEDIUM — Impersonation retains the administrator's data privileges.**
  - **Problem:** `requestDataContext()` substitutes the target user but retains the original actor's `system` flag. It also does not match the token's issuing administrator to the current actor.
  - **Why it matters:** Support sessions can perform operations unavailable to the impersonated user and cannot faithfully reproduce their permissions. This is not, by itself, a non-admin privilege escalation.
  - **Evidence:** `src/data/context.ts:37` and `:49`; system bypasses in `src/data/policy.ts` and `src/features/messaging/store.ts`. Reproduction produced a target-user context with no scopes and `system: true`.
  - **Proposed solution:** Represent the authenticated actor and effective data subject separately; impersonation must use the target's effective privileges, with both identities retained for auditing.
  - **Implementation:** Recompute target privileges instead of carrying `system`; verify token actor ownership and current impersonation permission; fail closed on a missing target. Test target-scope denial, inaccessible conversations, and tokens presented by another administrator.

- [:check: 2026-09-18 by Claude] [ARCH-9] **MEDIUM — Request identity has contradictory snapshots.**
  - **Problem:** Environment identity and request-context helpers are constructed before the admin boundary authenticates HTTP Basic requests. Later state mutations do not update those snapshots.
  - **Why it matters:** The same request appears authenticated to route state but anonymous to environment/context consumers, causing inconsistent authorization and incorrectly attributed events.
  - **Evidence:** `src/runtime/worker.ts:159`, `src/admin/auth.ts`, `src/auth/identity/index.ts`, and the environment copy in `src/runtime/hono.ts`. A Basic-authenticated `/admin` reproduction had `state.user.sub = basic:admin`, no environment user, context admin false, and context actor `system:read`.
  - **Proposed solution:** Resolve authentication once before constructing identity-dependent facades, repositories, and event helpers.
  - **Implementation:** Extract Basic/OIDC resolution into a shared early stage and publish one finalized request identity. Remove independently copied identity fields or derive them from that identity. Test agreement across state, environment, context, and event attribution for both authentication strategies.

- [:check: 2026-09-18 by Claude] [SEC-10] **MEDIUM — Parameter binding escapes the database audit wrapper.**
  - **Problem:** The statement proxy wraps execution methods but returns the underlying statement from `bind()`, losing the proxy.
  - **Why it matters:** The normal `prepare(...).bind(...).run()/first()/all()` path bypasses database audit logging, including security-sensitive parameterized mutations.
  - **Evidence:** `src/core/database/index.ts:46`, especially the generic method return at line 60. Reproduction emitted an audit event for unbound `SELECT 1` and none for bound `SELECT ?`.
  - **Proposed solution:** Preserve the audited statement abstraction across binding and execution.
  - **Implementation:** Explicitly wrap the statement returned by `bind()` and prevent duplicate wrapping. Keep batch handling compatible with native statements. Test bound reads/writes and batches for exactly-once audit records without logging sensitive parameter values.

- [ARCH-11] **MEDIUM — Messaging pagination occurs after bulk hydration.**
  - **Problem:** Listing conversations loads up to 1,000 tenant conversations, hydrates participants/messages for each, then filters access and slices the requested page.
  - **Why it matters:** A one-item page can require thousands of queries and load unrelated message bodies. An accessible conversation behind the first 1,000 inaccessible entries disappears from the listing entirely.
  - **Evidence:** `src/features/messaging/store.ts:132` and `hydrateConversation()`. A ten-conversation reproduction requesting one result performed 21 database calls.
  - **Proposed solution:** Apply tenant and creator/participant authorization in SQL before cursor pagination; list summaries without eagerly loading message histories.
  - **Implementation:** Add a dedicated scoped messaging query using participant `EXISTS`, stable `(updated_at, id)` pagination, and supporting tenant/participant indexes. Bulk-load participants only for the selected page and paginate messages separately. Test bounded query counts and accessible records behind more than 1,000 inaccessible records.
  - **Question:** The current `DataScopeReader` exposes only generic resource list/get methods, so the required participant `EXISTS` query needs a scoped query extension or a messaging-specific repository contract. Should messaging add that new reader contract, or may it use a dedicated D1 repository?

- [:check: 2026-09-18 by Claude] [MAINT-12] **MEDIUM — CLI access updates can leave partially changed permissions.**
  - **Problem:** `user:update` changes roles before validating tenants and replaces grants through separate delete/insert commands. It duplicates the application's access-management logic.
  - **Why it matters:** An invalid tenant, foreign-key failure, or interrupted command can leave a changed administrator flag, erased grants, or partially applied memberships despite reporting failure.
  - **Evidence:** `src/cli/users.ts:29` and `updateAssignments()` at line 49. For example, combining a role change with a nonexistent tenant executes the role update before throwing. Compare validated, batched access handling in `src/auth/users/access.ts`.
  - **Proposed solution:** Validate the complete requested change before writing, then commit roles and all assignment replacements atomically through shared access-management logic.
  - **Implementation:** Extract a reusable validated change plan and make the CLI invoke an authenticated administrative endpoint that applies it with D1 `batch()`; keep initial administrator bootstrap a separate explicit operation. Add failure tests asserting that invalid grants/tenants and mid-batch errors preserve the entire previous permission set.

- [:check: 2026-09-18 by Claude] [ARCH-13] **MEDIUM — Nested Hono error handlers bypass the advertised error boundary.**
  - **Problem:** The domain dispatcher and outer Hono runtime use default error handling, consuming exceptions before `createWorker()` can classify them.
  - **Why it matters:** Expected authorization/subscription failures become generic text HTTP 500 responses instead of the intended JSON HTTP 403, breaking client behavior and misclassifying operational errors.
  - **Evidence:** `src/api/contracts.ts:85`, `src/runtime/hono.ts:44`, and `src/runtime/worker.ts:198`. A domain handler throwing `DataScopeError` returned HTTP 500 with `Internal Server Error`.
  - **Proposed solution:** Use one shared error mapping boundary across domain, middleware, and fallback execution.
  - **Implementation:** Configure inner Hono handlers to propagate errors to that boundary, or install the same mapper at each boundary. Map typed authorization/body-limit errors to their intended status; retain generic nonleaking responses for unexpected failures. Test identical status, JSON envelope, and request ID across all handler paths.

- [:check: 2026-09-18 by Claude] [SEC-14] **MEDIUM — Built-in JSON handlers bypass the existing bounded parser.**
  - **Problem:** `readJsonObject()` calls `request.json()` without byte or media-type checks, despite a bounded parser already existing in the security module.
  - **Why it matters:** Authenticated callers of management endpoints can force large bodies into Worker memory. Applications reusing this exported helper inherit the same resource-exhaustion exposure; this is not an anonymous bypass of those endpoints' authentication.
  - **Evidence:** `src/api/http.ts:3`; callers in auth users/groups/tenants/subscriptions and healthcheck/circuit domains; bounded parsing in `src/core/security/index.ts`. A `text/plain` request containing a JSON string over 70,000 characters was accepted by the unbounded helper.
  - **Proposed solution:** Route shared JSON parsing through the existing streaming byte-limit and JSON media-type enforcement.
  - **Implementation:** Consolidate `readJsonObject()` with the security parser, retaining object-shape validation. Preserve HTTP 413/415 through domain catches and the central error mapper. Test oversized chunked bodies without Content-Length, invalid media types, and ordinary valid requests.

- [:check: 2026-09-18 by Claude] [MAINT-15] **MEDIUM — Prerelease tooling reuses immutable package versions and moves tags.**
  - **Problem:** Release planning reuses an existing `-pre` version and force-updates its Git tag, while CI attempts another npm publication of that version.
  - **Why it matters:** Subsequent publication fails, and the moved tag can point to source different from the already-published package. npm explicitly makes published name/version combinations [non-reusable](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
  - **Evidence:** `src/cli/project.ts:254`, release handling near line 540, and `finishRelease()` near line 609; `.github/workflows/publish.yml`; reuse expectations in `tests/cli-d1.test.mjs` and `CLI.md`.
  - **Proposed solution:** Give every prerelease a monotonically increasing version and immutable source tag.
  - **Implementation:** Generate versions such as `5.0.4-pre.0` and `5.0.4-pre.1`, reject registry/tag collisions, and remove force-tag/force-push behavior. Publish prereleases explicitly under `next` and stable releases under `latest`. Update documentation and test two consecutive release plans without publishing.

- [MAINT-16] **MEDIUM — Integration tests do not exercise the deployed persistence/runtime contract.**
  - **Problem:** The integration example uses a fake database that acknowledges writes without persisting them; core tests also use SQL-shaped stubs and a custom response double. Normal build verification does not run the separate example integration command.
  - **Why it matters:** Passing tests do not establish real SQL filtering, transactional behavior, or full-path WebSocket support. The anonymous-write, health-state, and response-wrapper defects above survived this coverage.
  - **Evidence:** `examples/todo-list/test/integration.test.mjs`, `tests/data.test.mjs`, `tests/jobs.test.mjs`, `tests/event-hub.test.mjs`, and build/test scripts in `package.json`. Typecheck, unit tests, and the existing example integration command all passed during review.
  - **Proposed solution:** Keep fast unit tests, but add a mandatory real Workers/D1 integration layer instead of treating permissive doubles as integration coverage.
  - **Implementation:** Run the full Worker under workerd-compatible test tooling with real local D1 and Durable Object bindings, applying repository and example migrations. Verify persisted CRUD, cross-tenant denial, batch rollback, job transitions, and authenticated WebSocket delivery. Wire this suite into CI/build verification.
  - **Question:** This repository has no workerd-compatible test dependency or Durable Object test harness configured. Should I introduce Miniflare/Wrangler test tooling and pin the required runtime versions, or is there an existing CI-provided harness to target?
