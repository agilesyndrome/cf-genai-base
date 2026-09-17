import { adminBoundary } from "../admin/router.js";
import type { AdminIdentity } from "../admin/types.js";
import { createRouteDispatcher } from "../api/contracts.js";
import { defineApp } from "../app.js";
import { AUTH_DOMAINS, ensureScopes, SubscriptionError } from "../auth/index.js";
import { requestActor, requestContext } from "../auth/identity/index.js";
import { CORE_DOMAINS } from "../core/domains.js";
import { auditedD1 } from "../core/database/index.js";
import { createEventHandler, type AppEvent } from "../core/events/index.js";
import { secureResponse } from "../core/security/index.js";
import { requestDataContext } from "../data/context.js";
import type { DataActorContext } from "../data/model.js";
import { createDataReader } from "../data/reader.js";
import { DataScopeError, normalizeDataResources } from "../data/resources.js";
import type { AnyAppDomain } from "../app.js";
import { resolveFeatures } from "../features/index.js";
import { createRepositories } from "../repository.js";
import type { RepositoryDefinitionInput } from "../repository/model.js";
import { createRuntimeDomains } from "./domains.js";
import { ensureFeatureManifests } from "./features.js";
import {
  createHonoRuntime,
  type RuntimeExecutionContext,
  type WorkerLayer,
} from "./hono.js";
import type {
  CreateWorkerOptions,
  RuntimeBindings,
  RuntimeFeature,
  RuntimeRequestEnvironment,
  RuntimeState,
} from "./model.js";

const scopeManifestPromises = new WeakMap<D1Database, Map<string, Promise<unknown>>>();
const removedWorkerOptions = [
  "features",
  "featureOptions",
  "auth",
  "repositories",
  "apiRoutes",
  "scopes",
  "scopeRoutes",
  "subscriptionManifest",
  "dataResources",
] as const;

/**
 * Compose one Worker from domains and feature manifests. Hono remains the only
 * request dispatcher; this function owns lifecycle, request state, and bindings.
 */
export function createWorker<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
>(options: CreateWorkerOptions<Env, State>) {
  for (const removed of removedWorkerOptions) {
    if (Object.hasOwn(options, removed)) {
      throw new TypeError(
        `createWorker.${removed} was removed in v5.0.3; register it through defineApp`,
      );
    }
  }
  if (typeof options?.fetch !== "function") {
    throw new TypeError("createWorker requires a fetch handler");
  }

  const {
    fetch,
    scheduled,
    app = { name: "worker" },
    authorize,
    middleware = [],
    publicTenantId = null,
    health,
    boot,
    security = true,
    eventHubBinding = "EVENT_HUB",
  } = options;
  const application = defineApp(app);
  const activeFeatures = resolveFeatures(application.features);
  const domains: AnyAppDomain[] = [
    ...AUTH_DOMAINS,
    ...CORE_DOMAINS,
    ...createRuntimeDomains({ health }),
    ...application.domains,
    ...activeFeatures.flatMap((feature) => feature.domains || []),
  ];
  validateDomains(domains);

  const registeredApiRoutes = domains.flatMap((domain) => domain.routes);
  const domainScopes = [...new Set(registeredApiRoutes.flatMap((route) => route.scopes))];
  const dispatchApiRoutes = registeredApiRoutes.length
    ? createRouteDispatcher(registeredApiRoutes)
    : null;
  const providerFeature = activeFeatures.find((feature) => typeof feature.getUser === "function");
  const provider = providerFeature?.getUser
    ? { getUser: providerFeature.getUser.bind(providerFeature) }
    : null;
  const eventHandler = createEventHandler(activeFeatures, { eventHubBinding });
  const repositoryDefinitions: RepositoryDefinitionInput[] = domains
    .flatMap((domain) => domain.repositories || []);
  const registeredDataResources = normalizeDataResources([
    ...domains.flatMap((domain) => domain.dataResources || []),
    ...repositoryDefinitions
      .flatMap((definition) => definition.resourceDefinition ? [definition.resourceDefinition] : []),
  ]);

  const layers: WorkerLayer<RuntimeRequestEnvironment<Env>, State>[] = [
    (request, env, ctx, next, state) => adminBoundary(
      request,
      env,
      ctx,
      next,
      state,
      { provider, authorize, features: activeFeatures },
    ),
    ...(dispatchApiRoutes
      ? [async (request: Request, env: RuntimeRequestEnvironment<Env>, ctx: RuntimeExecutionContext, next: (request?: Request) => Promise<Response>, state: State) =>
        (await dispatchApiRoutes(request, env, ctx, state)) || next(request)]
      : []),
    ...activeFeatures.flatMap((feature) =>
      feature.middleware ? [feature.middleware.bind(feature)] : []
    ),
    ...middleware,
  ];
  const runtime = createHonoRuntime<RuntimeRequestEnvironment<Env>, State>({
    layers,
    terminal: (request, env, ctx, state) => fetch(request, env, ctx, state),
  });

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      try {
        if (boot) await boot(env, { request, ctx });
        await Promise.all(domains.map((domain) => domain.initialize(env, { ctx })));

        const state = Object.assign(Object.create(null), {
          requestId: crypto.randomUUID(),
        }) as State;
        const url = new URL(request.url);
        if (env.DB && domainScopes.length && isAdminPath(url.pathname)) {
          await ensureScopeManifest(env, domainScopes);
        }
        if (provider?.getUser) {
          state.user = await Promise.resolve(provider.getUser(request, env)).catch(() => null);
        }
        if (state.user?.authUser) state.authUser = state.user.authUser;

        let dataContext: Promise<DataActorContext> | undefined;
        state.data = createDataReader(env, {
          resources: registeredDataResources,
          context: () => dataContext ||= requestDataContext(env, {
            state,
            request,
            publicTenantId,
          }),
        });

        // A per-request facade keeps identity and audited bindings out of shared globals.
        const requestEnv: RuntimeRequestEnvironment<Env> = {
          ...env,
          app: application,
          features: activeFeatures,
          eventHubBinding,
          DB: env.DB ? auditedD1(env.DB, requestActor(state)) : env.DB,
          data: state.data,
          user: state.user || null,
          authUser: state.authUser || null,
          userId: state.authUser?.id || null,
          eventHandler: (event, eventEnv, eventCtx) =>
            eventHandler(event, eventEnv || requestEnv, eventCtx || ctx),
        };
        requestEnv.repositories = createRepositories(requestEnv, repositoryDefinitions);
        requestEnv.requestId = state.requestId;
        state.context = requestContext({
          request,
          env: requestEnv,
          ctx,
          state,
          data: state.data,
        });
        requestEnv.context = state.context;
        requestEnv.event = state.context?.event;

        if (env.DB && hasOperationalManifest(activeFeatures)) {
          // Registration and breaker evaluation are background maintenance, not response work.
          ctx.waitUntil(
            ensureFeatureManifests(env, activeFeatures).catch((error: unknown) =>
              console.error("[EventLog] feature manifest registration failed", error)
            ),
          );
        }

        const response = await runtime.fetch(request, requestEnv, ctx, state);
        return withRequestId(
          security ? secureResponse(response) : response,
          state.requestId,
        );
      } catch (error: unknown) {
        console.error("[worker] request failed", error);
        const expected = error instanceof DataScopeError || error instanceof SubscriptionError;
        const errorResponse = expected
          ? Response.json(
            { error: error.message },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          )
          : Response.json(
            { error: "Internal server error" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        return withRequestId(
          security ? secureResponse(errorResponse) : errorResponse,
          errorRequestId(error) || crypto.randomUUID(),
        );
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
}

function hasOperationalManifest(features: readonly RuntimeFeature[]): boolean {
  return features.some((feature) =>
    typeof feature.healthcheck === "function"
    || Boolean(feature.healthchecks?.length)
    || Boolean(feature.circuitBreakers?.length)
  );
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", String(requestId));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/api/admin"
    || pathname.startsWith("/api/admin/");
}

function ensureScopeManifest(env: RuntimeBindings, scopes: readonly string[]): Promise<unknown> {
  if (!env.DB) return Promise.resolve();
  let registrations = scopeManifestPromises.get(env.DB);
  if (!registrations) {
    registrations = new Map();
    scopeManifestPromises.set(env.DB, registrations);
  }
  const key = JSON.stringify(scopes);
  let promise = registrations.get(key);
  if (!promise) {
    promise = ensureScopes(env, scopes, { who: "system:update" });
    registrations.set(key, promise);
    promise.catch(() => registrations?.delete(key));
  }
  return promise;
}

function validateDomains(domains: readonly AnyAppDomain[]): void {
  const names = new Set<string>();
  const routes = new Set<string>();
  for (const domain of domains) {
    if (
      !domain
      || typeof domain.name !== "string"
      || !Array.isArray(domain.routes)
      || typeof domain.initialize !== "function"
    ) throw new TypeError("Every registered domain must extend AppDomain");
    if (names.has(domain.name)) throw new TypeError(`Duplicate domain: ${domain.name}`);
    names.add(domain.name);

    for (const route of domain.routes) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        const key = `${method} ${route.path}`;
        if (routes.has(key)) throw new TypeError(`Duplicate domain route: ${key}`);
        routes.add(key);
      }
    }
  }
}

function errorRequestId(error: unknown): string | null {
  return error && typeof error === "object" && "requestId" in error
    ? String(error.requestId)
    : null;
}
