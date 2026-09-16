import { json, requestIdentity, sameOrigin } from "../core.js";
import { hasScope } from "../authorization.js";

export function defineRoute({ method = "GET", path, auth = "public", scope = null, csrf = false, handler } = {}) {
  if (!path || typeof handler !== "function") throw new TypeError("API routes require path and handler");
  return { method: String(method).toUpperCase(), path: String(path), auth, scope, csrf, handler };
}

export function matchRoute(request, route) {
  const url = new URL(request.url);
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  return methods.map((method) => String(method).toUpperCase()).includes(request.method.toUpperCase()) && (typeof route.path === "function" ? route.path(url.pathname, request) : route.path === url.pathname);
}

export async function dispatchRoutes(request, env, ctx, state, routes = []) {
  for (const route of routes) if (matchRoute(request, route)) {
    const identity = requestIdentity(state);
    if (route.auth === "user" && !identity.isAuthenticated) return json({ error: "Authentication is required." }, 401);
    if (route.auth === "admin" && !identity.isAdmin) return json({ error: "Administrator access is required." }, 403);
    if (route.csrf && !sameOrigin(request)) return json({ error: "A same-origin request is required." }, 403);
    if (route.scope && !(await hasScope(env, state?.user || state?.authUser, route.scope, { who: identity.who }))) return json({ error: "Required scope is missing." }, 403);
    return route.handler({ request, env, ctx, state, route, identity });
  }
  return null;
}

export async function apiFetch(input, options = {}) {
  const response = await fetch(input, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }, ...options });
  const payload = await response.clone().json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error || `Request failed (${response.status})`); error.status = response.status; error.requestId = response.headers.get("X-Request-ID") || payload?.request_id || null; throw error; }
  return payload === null ? response : payload;
}

export function apiJson(input, payload, options = {}) { return apiFetch(input, { ...options, method: options.method || "POST", body: JSON.stringify(payload) }); }
