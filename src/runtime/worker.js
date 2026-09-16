import { ensureSubscriptionManifest, SubscriptionError } from "../auth/index.js";
import { auditedD1, createEventHandler, listFeatureHealth, requestActor, requestContext, secureResponse } from "../core/index.js";
import { jobResponse, liveEventsResponse } from "../api/jobs.js";
import { createRepositories } from "../repository.js";
import { dispatchRoutes } from "../api/contracts.js";
import { defineApp } from "../app.js";
import { createDataReader } from "../data/reader.js";
import { DataScopeError, normalizeDataResources } from "../data/resources.js";
import { requestDataContext } from "../data/context.js";
import { adminBoundary } from "../admin/routes.js";
import { ensureFeatureManifests } from "./features.js";
import { healthResponse } from "./health.js";

export function createWorker({ fetch, scheduled, app = { name: "worker" }, auth, authorize, scopes = [], subscriptionManifest = [], scopeRoutes = [], apiRoutes = [], middleware = [], features = [], dataResources = [], repositories = [], publicTenantId = null, health, boot, security = true, eventHubBinding = "EVENT_HUB" }) {
  if (typeof fetch !== "function") throw new TypeError("createWorker requires a fetch handler");
  const application = defineApp(app); const provider = auth || features.find((feature) => typeof feature?.getUser === "function"); const eventHandler = createEventHandler(features, { eventHubBinding });
  const repositoryDefinitions = [...repositories, ...features.flatMap((feature) => Array.isArray(feature?.repositories) ? feature.repositories : [])];
  const registeredDataResources = normalizeDataResources([...dataResources, ...features.flatMap((feature) => Array.isArray(feature?.dataResources) ? feature.dataResources : []), ...repositoryDefinitions.filter((definition) => definition.resourceDefinition).map((definition) => definition.resourceDefinition)]);
  const featureRoutes = features.flatMap((feature) => Array.isArray(feature?.routes) ? [async (request, env, ctx, next, state) => { for (const route of feature.routes) { const matches = typeof route?.match === "function" ? await route.match(request, env, state) : route?.path === new URL(request.url).pathname; if (matches && typeof route.handle === "function") return route.handle({ request, env, ctx, state, next }); } return next(); }] : []);
  const chain = [(request, env, ctx, next, state) => adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes, features }), ...(apiRoutes.length ? [(request, env, ctx, next, state) => dispatchRoutes(request, env, ctx, state, apiRoutes).then((response) => response || next(request))] : []), ...features.flatMap((feature) => feature?.middleware ? [feature.middleware.bind(feature)] : []), ...featureRoutes, ...middleware, ...(auth ? [(request, env, ctx, next) => auth(request, env, ctx, next)] : [])].filter(Boolean);
  return {
    async fetch(request, env, ctx) {
      try {
        if (boot) await boot(env, { request, ctx });
        if (subscriptionManifest.length) await ensureSubscriptionManifest(env, subscriptionManifest, { who: "system:update" });
        const url = new URL(request.url); const state = Object.create(null); state.requestId = crypto.randomUUID();
        if (provider?.getUser) state.user = await provider.getUser(request, env).catch(() => null); if (state.user?.authUser) state.authUser = state.user.authUser;
        state.data = createDataReader(env, { resources: registeredDataResources, context: () => requestDataContext(env, { state, request, publicTenantId }) });
        const requestEnv = Object.create(env || null);
        Object.assign(requestEnv, { app: application, DB: env?.DB ? auditedD1(env.DB, requestActor(state)) : env?.DB, data: state.data, repositories: createRepositories(requestEnv, repositoryDefinitions), user: state.user || null, authUser: state.authUser || null, userId: state.authUser?.id || null, eventHandler: (event, eventEnv, eventCtx) => eventHandler(event, eventEnv || requestEnv, eventCtx || ctx) });
        requestEnv.requestId = state.requestId; state.context = requestContext({ request, env: requestEnv, ctx, state, data: state.data }); requestEnv.context = state.context; requestEnv.event = state.context.event;
        if (env?.DB && features.some((feature) => typeof feature?.healthcheck === "function" || feature?.healthchecks?.length || feature?.healthChecks?.length || feature?.circuitBreakers?.length || feature?.circuit_breakers?.length)) ctx?.waitUntil?.(ensureFeatureManifests(env, features).catch((error) => console.error("[EventLog] feature manifest registration failed", error)));
        const dispatch = async (index, currentRequest = request) => { const layer = chain[index]; if (!layer) { if (url.pathname === "/health" || url.pathname === "/api/health") { const details = health ? await health(requestEnv, { request: currentRequest, ctx, state }) : {}; const featureHealth = requestEnv?.DB ? await listFeatureHealth(requestEnv, { who: "system:read" }).catch(() => []) : []; return healthResponse(requestEnv, featureHealth.length ? { ...details, features: featureHealth } : details); } if (url.pathname === "/api/tenant" && currentRequest.method === "GET") { const context = await state.data.context(); if (!context.userId) return Response.json({ error: "Authentication is required." }, { status: 401 }); if (context.invalidTenant) return Response.json({ error: "The requested tenant is not available." }, { status: 400 }); return Response.json({ tenant: context.tenantId ? { id: context.tenantId, name: context.tenants?.find((tenant) => tenant.id === context.tenantId)?.name || null } : null, tenants: context.tenants || [] }); } return fetch(currentRequest, requestEnv, ctx, state); } if (typeof layer !== "function") throw new TypeError("Worker middleware must be a function"); return layer(currentRequest, requestEnv, ctx, (nextRequest = currentRequest) => dispatch(index + 1, nextRequest), state); };
        const liveResponse = await liveEventsResponse(request, requestEnv, state, eventHubBinding);
        if (liveResponse) return liveResponse;
        const response = await jobResponse(request, requestEnv, state) || await dispatch(0); return withRequestId(security ? secureResponse(response) : response, state.requestId);
      } catch (error) {
        console.error("[worker] request failed", error); const errorResponse = error instanceof DataScopeError || error instanceof SubscriptionError ? Response.json({ error: error.message }, { status: 403, headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } }); return withRequestId(security ? secureResponse(errorResponse) : errorResponse, error?.requestId || crypto.randomUUID());
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
}

function withRequestId(response, requestId) { const headers = new Headers(response.headers); headers.set("X-Request-ID", String(requestId)); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); }
