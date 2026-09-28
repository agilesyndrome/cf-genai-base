import { adminBoundary } from "../admin/router.js";
import { createRouteDispatcher } from "../api/contracts.js";
import { defineApp } from "../app.js";
import { AUTH_DOMAINS, SubscriptionError } from "../auth/index.js";
import { requestActor, requestContext } from "../auth/identity/index.js";
import { CORE_DOMAINS } from "../core/domains.js";
import { auditedD1, readOnlyD1 } from "../core/database/index.js";
import { createEventHandler, type AppEvent } from "../core/events/index.js";
import { secureResponse } from "../core/security/index.js";
import { SecurityRequestError } from "../core/security/index.js";
import { requestDataContext } from "../data/context.js";
import { createReadOnlyDataReader } from "../data/reader.js";
import { createRecordDomains } from "../data/records.js";
import type { DataActorContext } from "../data/model.js";
import { createDataReader } from "../data/reader.js";
import { DataScopeError, normalizeDataResources } from "../data/resources.js";
import type { AnyAppDomain } from "../app.js";
import { resolveFeatures } from "../features/index.js";
import { createRepositories } from "../repository.js";
import type { RepositoryDefinitionInput } from "../repository/model.js";
import { createRuntimeDomains } from "./domains.js";
import { ensureFeatureManifests, refreshFeatureManifests } from "./features.js";
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
import { assertBoot } from "./health.js";

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
    requiredBindings = [],
    security = true,
    eventHubBinding = "EVENT_HUB",
  } = options;
  const application = defineApp(app);
  const activeFeatures = resolveFeatures(application.features);
  const domains: AnyAppDomain[] = [
    ...AUTH_DOMAINS,
    ...CORE_DOMAINS,
    ...createRuntimeDomains({ health }),
    ...createRecordDomains(application.records),
    ...application.domains,
    ...application.readOnlyDomains,
    ...activeFeatures.flatMap((feature) => feature.domains || []),
  ];
  validateDomains(domains, new Set(application.readOnlyDomains));

  const readOnlyDomainSet = new Set(application.readOnlyDomains);
  const registeredApiRoutes = domains.flatMap((domain) => domain.routes.map((route) =>
    readOnlyDomainSet.has(domain) ? { ...route, readOnly: true } : route
  ));
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
    ...activeFeatures.flatMap((feature) =>
      feature.middleware ? [feature.middleware.bind(feature)] : []
    ),
    ...middleware,
    ...(dispatchApiRoutes
      ? [async (request: Request, env: RuntimeRequestEnvironment<Env>, ctx: RuntimeExecutionContext, next: (request?: Request) => Promise<Response>, state: State) =>
        (await dispatchApiRoutes(request, env, ctx, state)) || next(request)]
      : []),
  ];
  const runtime = createHonoRuntime<RuntimeRequestEnvironment<Env>, State>({
    layers,
    terminal: (request, env, ctx, state) => fetch(request, env, ctx, state),
  });

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      try {
        const url = new URL(request.url);
        assertBoot(env, { bindings: requiredBindings });
        const requiredEnvironment = activeFeatures.flatMap((feature) =>
          feature.requiredEnvironment?.({ request, url }) || []
        );
        assertBoot(env, { required: [...new Set(requiredEnvironment)] });
        if (boot) await boot(env, { request, ctx });
        await Promise.all(domains.map((domain) => domain.initialize(env, { ctx })));

        const state = Object.assign(Object.create(null), {
          requestId: crypto.randomUUID(),
        }) as State;
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
          get user() { return state.user || null; },
          get authUser() { return state.authUser || state.user?.authUser || null; },
          get userId() { return state.authUser?.id || state.user?.authUser?.id || null; },
          eventHandler: (event, eventEnv, eventCtx) =>
            eventHandler(event, eventEnv || requestEnv, eventCtx || ctx),
        };
        requestEnv.repositories = createRepositories(requestEnv, repositoryDefinitions);
        requestEnv.requestId = state.requestId;
        const readOnlyData = state.data ? createReadOnlyDataReader(state.data) : undefined;
        const readOnlyEnv = Object.create(requestEnv) as RuntimeRequestEnvironment<Env>;
        if (requestEnv.DB) readOnlyEnv.DB = readOnlyD1(requestEnv.DB);
        readOnlyEnv.data = readOnlyData;
        readOnlyEnv.repositories = createRepositories(readOnlyEnv, repositoryDefinitions);
        state.readOnlyState = Object.assign(Object.create(null), state, {
          data: readOnlyData,
          readOnlyState: undefined,
          readOnlyEnv: undefined,
        });
        state.readOnlyEnv = readOnlyEnv;
        state.context = requestContext({
          request,
          env: requestEnv,
          ctx,
          state,
          data: state.data,
        });
        requestEnv.context = state.context;
        requestEnv.event = state.context?.event;
        if (state.readOnlyState) {
          const readOnlyContext = requestContext({
            request,
            env: readOnlyEnv,
            ctx,
            state: state.readOnlyState,
            data: readOnlyData,
          });
          state.readOnlyState.context = readOnlyContext;
          readOnlyEnv.context = readOnlyContext;
          readOnlyEnv.event = readOnlyContext.event;
        }

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
        const status = responseStatus(error);
        const message = error instanceof Error ? error.message : "Unable to complete the request";
        const errorResponse = status
          ? Response.json(
            { error: message },
            { status, headers: { "Cache-Control": "no-store" } },
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
    ...(scheduled ? {
      scheduled: async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
        await scheduled(controller, env, ctx);
        if (env.DB && hasOperationalManifest(activeFeatures)) {
          await refreshFeatureManifests(env, activeFeatures, { who: "system:update" });
        }
      },
    } : {}),
  };
}

function responseStatus(error: unknown): number | null {
  if (error instanceof DataScopeError || error instanceof SubscriptionError) return 403;
  if (error instanceof SecurityRequestError) return error.status;
  if (error && typeof error === "object" && "status" in error) {
    const status = Reflect.get(error, "status");
    if (typeof status === "number" && status >= 400 && status < 500) return status;
  }
  return null;
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
    ...(response.status === 101 && response.webSocket ? { webSocket: response.webSocket } : {}),
  });
}

function validateDomains(domains: readonly AnyAppDomain[], readOnlyDomains: ReadonlySet<AnyAppDomain>): void {
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
        if (readOnlyDomains.has(domain) && ["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase())) {
          throw new TypeError(`Read-only domain ${domain.name} cannot register ${String(method).toUpperCase()} routes`);
        }
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
