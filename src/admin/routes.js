import { createAuthorizationTenant, createImpersonationToken, ensureScopes, ensureUser, getAuthorizationTenant, getAuthorizationUser, hasScope, listAuthorizationScopes, listAuthorizationTenants, listAuthorizationUsers, listGroups, listUserGroups, listUserGrants, listUserTenants, replaceUserGroups, replaceUserTenants, replaceUserGrants, updateAuthorizationTenant } from "../auth/index.js";
import { getCircuitBreaker, listCircuitBreakers, listFeatureCatalog, listFeatureHealth, listHealthchecks, requestActor, setCircuitBreaker, updateHealthcheck } from "../core/index.js";

export async function adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes, features }) {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return next(request);
  const strategy = String(env?.AUTH_STRATEGY || "http_basic").trim().toLowerCase();
  if (strategy === "http_basic") { const user = basicUser(request, env); if (!user) return adminUnauthorized(request); state.user = user; }
  else if (strategy === "oauth") { const user = Object.hasOwn(state, "user") ? state.user : provider?.getUser ? await provider.getUser(request, env) : null; if (!user) return oauthUnauthorized(request, url); state.user = user; }
  else return new Response("Unsupported AUTH_STRATEGY", { status: 500, headers: { "Cache-Control": "no-store" } });
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && url.pathname.startsWith("/api/")) { const origin = request.headers.get("Origin"); if (!origin || (() => { try { return new URL(origin).origin !== url.origin; } catch { return true; } })()) return Response.json({ error: "A same-origin request is required." }, { status: 403, headers: { "Cache-Control": "no-store" } }); }
  const who = state.user?.auth_strategy === "http_basic" ? "user:admin" : `user:${state.user?.sub || "unknown"}`;
  await ensureScopes(env, scopes, { who });
  state.authUser = state.user?.authUser || await ensureUser(env, state.user, { who }); state.requestedBy = requestActor(state);
  const requiredScope = requiredScopeFor(url.pathname, scopeRoutes); const scopeAllowed = !requiredScope || await hasScope(env, state.user, requiredScope, { who: requestActor(state) });
  if (!scopeAllowed || (authorize && state.user.auth_strategy !== "http_basic" && !(await authorize({ request, url, user: state.user, env, ctx, state })))) return url.pathname.startsWith("/api/") ? Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } }) : new Response("Administrator access is required.", { status: 403, headers: { "Cache-Control": "no-store" } });
  const platformResponse = await authorizationApi(request, env, url, state, features); if (platformResponse) return platformResponse;
  return next(request);
}

async function authorizationApi(request, env, url, state, features = []) {
  const grantsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/scopes$/);
  const platformPath = url.pathname === "/api/admin/users" || url.pathname === "/api/admin/tenants" || url.pathname.startsWith("/api/admin/tenants/") || url.pathname === "/api/admin/scopes" || url.pathname === "/api/admin/groups" || url.pathname.startsWith("/api/admin/users/") || url.pathname.startsWith("/api/admin/impersonate") || url.pathname === "/api/admin/status" || url.pathname === "/api/admin/features" || url.pathname === "/api/admin/healthchecks" || url.pathname === "/api/admin/circuit-breakers" || url.pathname.startsWith("/api/admin/healthchecks/") || url.pathname.startsWith("/api/admin/circuit-breakers/") || Boolean(grantsMatch);
  if (!platformPath) return null;
  if (!(state.user.auth_strategy === "http_basic" || (state.authUser && state.authUser.is_admin))) return Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const who = { who: requestActor(state) };
  if (url.pathname === "/api/admin/impersonate/clear" && request.method === "POST") return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8", "Set-Cookie": "__Host-cfgenai_impersonation=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax" } });
  if (url.pathname === "/api/admin/users" && request.method === "GET") return Response.json({ users: await listAuthorizationUsers(env, who) });
  if (url.pathname === "/api/admin/tenants" && request.method === "GET") return Response.json({ tenants: await listAuthorizationTenants(env, who) });
  if (url.pathname === "/api/admin/tenants" && request.method === "POST") { const body = await request.json().catch(() => null); if (!body?.id || !body?.name) return Response.json({ error: "id and name are required" }, { status: 400 }); try { return Response.json({ tenant: await createAuthorizationTenant(env, body.id, body.name, who) }, { status: 201 }); } catch (error) { return Response.json({ error: error.message }, { status: 400 }); } }
  const tenantMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  if (tenantMatch && request.method === "GET") return Response.json({ tenant: await getAuthorizationTenant(env, decodeURIComponent(tenantMatch[1]), who) });
  if (tenantMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.name) return Response.json({ error: "name is required" }, { status: 400 }); return Response.json({ tenant: await updateAuthorizationTenant(env, decodeURIComponent(tenantMatch[1]), body.name, who) }); }
  const impersonateMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/impersonate$/);
  if (impersonateMatch && request.method === "POST") { const targetUser = await getAuthorizationUser(env, decodeURIComponent(impersonateMatch[1]), who); if (!targetUser) return Response.json({ error: "User not found." }, { status: 404 }); const token = await createImpersonationToken(env, state.authUser?.id || state.user?.sub || "admin", targetUser.id); return new Response(JSON.stringify({ ok: true, user: { id: targetUser.id, email: targetUser.email, display_name: targetUser.display_name }, expires_in: 900 }), { headers: { "content-type": "application/json; charset=utf-8", "Set-Cookie": `__Host-cfgenai_impersonation=${token}; Max-Age=900; Path=/; Secure; HttpOnly; SameSite=Lax` } }); }
  if (url.pathname === "/api/admin/scopes" && request.method === "GET") return Response.json({ scopes: await listAuthorizationScopes(env, who) });
  if (url.pathname === "/api/admin/status" && request.method === "GET") return Response.json({ features: await listFeatureHealth(env, who) });
  if (url.pathname === "/api/admin/features" && request.method === "GET") return Response.json({ features: await listFeatureCatalog(env, features, who) });
  if (url.pathname === "/api/admin/groups" && request.method === "GET") return Response.json({ groups: await listGroups(env, who) });
  if (url.pathname === "/api/admin/healthchecks" && request.method === "GET") return Response.json({ healthchecks: await listHealthchecks(env, who) });
  if (url.pathname === "/api/admin/circuit-breakers" && request.method === "GET") return Response.json({ circuit_breakers: await listCircuitBreakers(env, who) });
  const healthcheckMatch = url.pathname.match(/\/api\/admin\/healthchecks\/([^/]+)$/);
  if (healthcheckMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const healthcheck = await updateHealthcheck(env, decodeURIComponent(healthcheckMatch[1]), body.state, who); return healthcheck ? Response.json({ healthcheck }) : Response.json({ error: "Healthcheck not found" }, { status: 404 }); }
  const breakerMatch = url.pathname.match(/\/api\/admin\/circuit-breakers\/([^/]+)$/);
  if (breakerMatch && request.method === "GET") return Response.json({ circuit_breaker: await getCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), who) });
  if (breakerMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const breaker = await setCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), body.state, who); return breaker ? Response.json({ circuit_breaker: breaker }) : Response.json({ error: "Circuit breaker not found" }, { status: 404 }); }
  const groupsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/groups$/);
  if (groupsMatch && request.method === "GET") return Response.json({ groups: await listUserGroups(env, decodeURIComponent(groupsMatch[1]), who) });
  if (groupsMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body || !Array.isArray(body.groups)) return Response.json({ error: "groups must be an array" }, { status: 400 }); return Response.json({ groups: await replaceUserGroups(env, decodeURIComponent(groupsMatch[1]), body.groups, state.authUser && state.authUser.id, who) }); }
  const tenantsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/tenants$/);
  if (tenantsMatch && request.method === "GET") return Response.json({ tenants: await listUserTenants(env, decodeURIComponent(tenantsMatch[1]), who) });
  if (tenantsMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body || !Array.isArray(body.tenants)) return Response.json({ error: "tenants must be an array" }, { status: 400 }); return Response.json({ tenants: await replaceUserTenants(env, decodeURIComponent(tenantsMatch[1]), body.tenants, who) }); }
  if (grantsMatch && request.method === "GET") return Response.json({ grants: await listUserGrants(env, decodeURIComponent(grantsMatch[1]), who) });
  if (grantsMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body || !Array.isArray(body.scopes)) return Response.json({ error: "scopes must be an array" }, { status: 400 }); const grants = await replaceUserGrants(env, decodeURIComponent(grantsMatch[1]), body.scopes, state.authUser && state.authUser.id, who); return Response.json({ grants }); }
  return null;
}

function isAdminPath(pathname) { return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/"); }
function requiredScopeFor(pathname, routes) { const route = routes.find((entry) => typeof entry.match === "function" ? entry.match(pathname) : pathname === entry.path || pathname.startsWith(String(entry.path || "") + "/")); return route && route.scope ? route.scope : null; }
function basicUser(request, env) { const token = String(env?.ADMIN_TOKEN || ""); if (!token) return null; const header = request.headers.get("Authorization") || ""; if (!header.toLowerCase().startsWith("basic ")) return null; let decoded; try { decoded = atob(header.slice(6).trim()); } catch { return null; } const separator = decoded.indexOf(":"); if (separator < 0 || !constantTimeEqual(decoded.slice(0, separator), "admin") || !constantTimeEqual(decoded.slice(separator + 1), token)) return null; return { sub: "basic:admin", email: "", name: "admin", roles: ["admin"], auth_strategy: "http_basic" }; }
function adminUnauthorized(request) { const headers = { "Cache-Control": "no-store", "WWW-Authenticate": "Basic realm=\"admin\", charset=\"UTF-8\"" }; return new URL(request.url).pathname.startsWith("/api/") ? Response.json({ error: "Authentication is required." }, { status: 401, headers }) : new Response("Authentication is required.", { status: 401, headers }); }
function oauthUnauthorized(request, url) { if (url.pathname.startsWith("/api/")) return Response.json({ error: "Authentication is required." }, { status: 401, headers: { "Cache-Control": "no-store" } }); return Response.redirect(url.origin + "/auth/login?return_to=" + encodeURIComponent(safeReturnTo(url.pathname + url.search)), 302); }
function safeReturnTo(value) { return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth/") ? value : "/"; }
function constantTimeEqual(a, b) { const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b); let n = aa.length ^ bb.length; for (let i = 0; i < Math.max(aa.length, bb.length); i++) n |= (aa[i] || 0) ^ (bb[i] || 0); return n === 0; }
