/**
 * Lean, opinionated Worker composition for Cloudflare sites.
 * Site code owns domain routes and data; this owns lifecycle and edge concerns.
 */
import { ensureScopes, ensureUser, hasScope, listAuthorizationScopes, listAuthorizationUsers, listUserGrants, replaceUserGrants } from "./authorization.js";
import { getCircuitBreaker, listCircuitBreakers, listHealthchecks, listFeatureHealth, registerFeatureManifests, requestActor, setCircuitBreaker, updateHealthcheck } from "./core.js";
export * from "./core.js";
export function createWorker({ fetch, scheduled, auth, authorize, scopes = [], scopeRoutes = [], middleware = [], features = [], health, boot, metrics, security = true }) {
  if (typeof fetch !== "function") throw new TypeError("createWorker requires a fetch handler");
  const provider = auth || features.find((feature) => typeof feature?.getUser === "function");
  const chain = [
    (request, env, ctx, next, state) => adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes }),
    ...features.flatMap((feature) => feature?.middleware ? [feature.middleware.bind(feature)] : []),
    ...middleware,
    ...(auth ? [(request, env, ctx, next) => auth(request, env, ctx, next)] : []),
  ].filter(Boolean);
  return {
    async fetch(request, env, ctx) {
      try {
        if (boot) await boot(env, { request, ctx });
        const url = new URL(request.url);
        const state = Object.create(null);
        if (env?.DB && features.some((feature) => typeof feature?.healthcheck === "function" || feature?.healthchecks?.length || feature?.healthChecks?.length || feature?.circuitBreakers?.length || feature?.circuit_breakers?.length)) ctx?.waitUntil?.(registerFeatureManifests(env, features, { who: "system:update" }).catch((error) => console.error("[EventLog] feature manifest registration failed", error)));
        const dispatch = async (index, currentRequest = request) => {
          const layer = chain[index];
          if (!layer) {
            if (url.pathname === "/health" || url.pathname === "/api/health") {
              const details = health ? await health(env, { request: currentRequest, ctx, state }) : {};
              const featureHealth = env?.DB ? await listFeatureHealth(env, { who: "system:read" }).catch(() => []) : [];
              return healthResponse(env, featureHealth.length ? { ...details, features: featureHealth } : details);
            }
            return fetch(currentRequest, env, ctx, state);
          }
          if (typeof layer !== "function") throw new TypeError("Worker middleware must be a function");
          return layer(currentRequest, env, ctx, (nextRequest = currentRequest) => dispatch(index + 1, nextRequest), state);
        };
        const response = await dispatch(0);
        if (metrics) metrics.request(request, response, env, ctx);
        return security ? secureResponse(response) : response;
      } catch (error) {
        console.error("[worker] request failed", error);
        return secureResponse(Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } }));
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
}


async function adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes }) {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return next(request);
  const strategy = String(env?.AUTH_STRATEGY || "http_basic").trim().toLowerCase();
  if (strategy === "http_basic") {
    const user = basicUser(request, env);
    if (!user) return adminUnauthorized(request);
    state.user = user;
  } else if (strategy === "oauth") {
    const user = provider?.getUser ? await provider.getUser(request, env) : null;
    if (!user) return oauthUnauthorized(request, url);
    state.user = user;
  } else {
    return new Response("Unsupported AUTH_STRATEGY", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  await ensureScopes(env, scopes, { who: state.user?.auth_strategy === "http_basic" ? "user:admin" : `user:${state.user?.sub || "unknown"}` });
  state.authUser = await ensureUser(env, state.user, { who: state.user?.auth_strategy === "http_basic" ? "user:admin" : `user:${state.user?.sub || "unknown"}` });
  state.requestedBy = requestActor(state);
  const requiredScope = requiredScopeFor(url.pathname, scopeRoutes);
  const scopeAllowed = !requiredScope || await hasScope(env, state.user, requiredScope, { who: requestActor(state) });
  if (!scopeAllowed || (authorize && state.user.auth_strategy !== "http_basic" && !(await authorize({ request, url, user: state.user, env, ctx, state })))) {
    return url.pathname.startsWith("/api/") ? Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } }) : new Response("Administrator access is required.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const platformResponse = await authorizationApi(request, env, url, state);
  return platformResponse || next(request);
}

function requiredScopeFor(pathname, routes) {
  const route = routes.find((entry) => typeof entry.match === "function" ? entry.match(pathname) : pathname === entry.path || pathname.startsWith(String(entry.path || "") + "/"));
  return route && route.scope ? route.scope : null;
}

async function authorizationApi(request, env, url, state) {
  const grantsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/scopes$/);
  const platformPath = url.pathname === "/api/admin/users" || url.pathname === "/api/admin/scopes" || url.pathname === "/api/admin/status" || url.pathname === "/api/admin/healthchecks" || url.pathname === "/api/admin/circuit-breakers" || url.pathname.startsWith("/api/admin/healthchecks/") || url.pathname.startsWith("/api/admin/circuit-breakers/") || Boolean(grantsMatch);
  if (!platformPath) return null;
  if (!(state.user.auth_strategy === "http_basic" || (state.authUser && state.authUser.is_admin))) return Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (url.pathname === "/api/admin/users" && request.method === "GET") return Response.json({ users: await listAuthorizationUsers(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/scopes" && request.method === "GET") return Response.json({ scopes: await listAuthorizationScopes(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/status" && request.method === "GET") return Response.json({ features: await listFeatureHealth(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/healthchecks" && request.method === "GET") return Response.json({ healthchecks: await listHealthchecks(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/circuit-breakers" && request.method === "GET") return Response.json({ circuit_breakers: await listCircuitBreakers(env, { who: requestActor(state) }) });
  const healthcheckMatch = url.pathname.match(/\/api\/admin\/healthchecks\/([^/]+)$/);
  if (healthcheckMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const healthcheck = await updateHealthcheck(env, decodeURIComponent(healthcheckMatch[1]), body.state, { who: requestActor(state) }); return healthcheck ? Response.json({ healthcheck }) : Response.json({ error: "Healthcheck not found" }, { status: 404 }); }
  const breakerMatch = url.pathname.match(/\/api\/admin\/circuit-breakers\/([^/]+)$/);
  if (breakerMatch && request.method === "GET") return Response.json({ circuit_breaker: await getCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), { who: requestActor(state) }) });
  if (breakerMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const breaker = await setCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), body.state, { who: requestActor(state) }); return breaker ? Response.json({ circuit_breaker: breaker }) : Response.json({ error: "Circuit breaker not found" }, { status: 404 }); }
  if (grantsMatch && request.method === "GET") return Response.json({ grants: await listUserGrants(env, decodeURIComponent(grantsMatch[1]), { who: requestActor(state) }) });
  if (grantsMatch && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.scopes)) return Response.json({ error: "scopes must be an array" }, { status: 400 });
    const grants = await replaceUserGrants(env, decodeURIComponent(grantsMatch[1]), body.scopes, state.authUser && state.authUser.id, { who: requestActor(state) });
    return Response.json({ grants });
  }
  return null;
}

function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function basicUser(request, env) {
  const token = String(env?.ADMIN_TOKEN || env?.admin_token || "");
  if (!token) return null;
  const header = request.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  let decoded;
  try { decoded = atob(header.slice(6).trim()); } catch { return null; }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  if (!constantTimeEqual(decoded.slice(0, separator), "admin") || !constantTimeEqual(decoded.slice(separator + 1), token)) return null;
  return { sub: "basic:admin", email: "", name: "admin", roles: ["admin"], auth_strategy: "http_basic" };
}

function adminUnauthorized(request) {
  const headers = { "Cache-Control": "no-store", "WWW-Authenticate": "Basic realm=\"admin\", charset=\"UTF-8\"" };
  return new URL(request.url).pathname.startsWith("/api/") ? Response.json({ error: "Authentication is required." }, { status: 401, headers }) : new Response("Authentication is required.", { status: 401, headers });
}

function oauthUnauthorized(request, url) {
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Authentication is required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.redirect(url.origin + "/auth/login?return_to=" + encodeURIComponent(safeReturnTo(url.pathname + url.search)), 302);
}

function safeReturnTo(value) { return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth/") ? value : "/"; }
function constantTimeEqual(a, b) { const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b); let n = aa.length ^ bb.length; for (let i = 0; i < Math.max(aa.length, bb.length); i++) n |= (aa[i] || 0) ^ (bb[i] || 0); return n === 0; }

export function validateBoot(env, { bindings = [], required = [] } = {}) {
  const missingBindings = bindings.filter((name) => !env?.[name]);
  const missingValues = required.filter((name) => !env?.[name] || String(env[name]).startsWith("replace-with-"));
  return { ok: missingBindings.length === 0 && missingValues.length === 0, missingBindings, missingValues };
}

export function assertBoot(env, spec = {}) {
  const result = validateBoot(env, spec);
  if (!result.ok) throw new Error(`Worker boot validation failed: ${[...result.missingBindings, ...result.missingValues].join(", ")}`);
  return result;
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function methodNotAllowed(allow = "GET") {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } });
}

export function healthResponse(env, details = {}) {
  return Response.json({ ok: true, version: String(env.BUILD_SHA || "unknown").slice(0, 7), build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null, ...details }, { headers: { "Cache-Control": "no-store" } });
}

export function createMetrics({ tokenEnv = "POSTHOG_TOKEN", host = "https://us.i.posthog.com" } = {}) {
  return {
    request(request, response, env, ctx) {
      if (!env?.[tokenEnv] || !ctx?.waitUntil || new URL(request.url).pathname === "/health") return;
      const event = response.status >= 500 ? "server_error" : "request";
      ctx.waitUntil(track(env, event, { path: new URL(request.url).pathname, method: request.method, status: response.status }, { tokenEnv, host }));
    },
    track: (env, event, properties, ctx) => ctx?.waitUntil?.(track(env, event, properties, { tokenEnv, host })),
  };
}

async function track(env, event, properties, { tokenEnv, host }) {
  try {
    const token = String(env?.[tokenEnv] || "");
    if (!token) return;
    await fetch(`${host.replace(/\/+$/, "")}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: token, event, properties: { ...properties, distinct_id: properties?.distinct_id || "anonymous" } }) });
  } catch (error) {
    console.error("[metrics] delivery failed", error);
  }
}
