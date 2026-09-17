import { ensureUser } from "../auth/index.js";
import { requestActor } from "../auth/identity/index.js";
import { jsonError, NO_STORE_HEADERS } from "../api/http.js";
import type {
  AdminBindings,
  AdminIdentity,
  AdminRequestState,
  AdminUserProvider,
} from "./types.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function authenticateAdminRequest<
  Env extends AdminBindings,
  User extends AdminIdentity,
  State extends AdminRequestState<User>,
>(
  request: Request,
  env: Env,
  url: URL,
  state: State,
  provider?: AdminUserProvider<Env, User> | null,
): Promise<Response | null> {
  const strategy = String(env.AUTH_STRATEGY ?? "http_basic").trim().toLowerCase();

  if (strategy === "http_basic") {
    const user = basicUser(request, env) as User | null;
    if (!user) return authenticationRequired(request);
    state.user = user;
    return null;
  }

  if (strategy === "oauth") {
    const user = Object.hasOwn(state, "user")
      ? state.user
      : provider
        ? await provider.getUser(request, env)
        : null;
    if (!user) return oauthAuthenticationRequired(url);
    state.user = user;
    return null;
  }

  return new Response("Unsupported AUTH_STRATEGY", {
    status: 500,
    headers: NO_STORE_HEADERS,
  });
}

export function requireSameOriginMutation(request: Request, url: URL): Response | null {
  if (!MUTATING_METHODS.has(request.method) || !url.pathname.startsWith("/api/")) return null;
  const origin = request.headers.get("Origin");
  try {
    if (origin && new URL(origin).origin === url.origin) return null;
  } catch {
    // A malformed Origin is untrusted just like a cross-origin value.
  }
  return jsonError("A same-origin request is required.", 403);
}

export function actorFor(user: AdminIdentity): string {
  return user.auth_strategy === "http_basic" ? "user:admin" : `user:${user.sub || "unknown"}`;
}

export function isPlatformAdministrator(state: AdminRequestState): boolean {
  return state.user?.auth_strategy === "http_basic" || Boolean(state.authUser?.is_admin);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export function administratorRequired(url: URL): Response {
  return url.pathname.startsWith("/api/")
    ? jsonError("Administrator access is required.", 403)
    : new Response("Administrator access is required.", { status: 403, headers: NO_STORE_HEADERS });
}

export function authenticationRequired(request: Request): Response {
  const headers = { ...NO_STORE_HEADERS, "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"' };
  return new URL(request.url).pathname.startsWith("/api/")
    ? Response.json({ error: "Authentication is required." }, { status: 401, headers })
    : new Response("Authentication is required.", { status: 401, headers });
}

export function oauthAuthenticationRequired(url: URL): Response {
  if (url.pathname.startsWith("/api/")) return jsonError("Authentication is required.", 401);
  return Response.redirect(`${url.origin}/auth/login?return_to=${encodeURIComponent(safeReturnTo(url.pathname + url.search))}`, 302);
}

export function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth/") ? value : "/";
}

function basicUser(request: Request, env: AdminBindings): AdminIdentity | null {
  const token = String(env.ADMIN_TOKEN ?? "");
  if (!token) return null;
  const header = request.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return null;

  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0 || !constantTimeEqual(decoded.slice(0, separator), "admin") || !constantTimeEqual(decoded.slice(separator + 1), token)) return null;
  return { sub: "basic:admin", email: "", name: "admin", roles: ["admin"], auth_strategy: "http_basic" };
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let difference = aa.length ^ bb.length;
  for (let index = 0; index < Math.max(aa.length, bb.length); index += 1) difference |= (aa[index] ?? 0) ^ (bb[index] ?? 0);
  return difference === 0;
}

export async function prepareAdminState<
  Env extends AdminBindings,
  User extends AdminIdentity,
  State extends AdminRequestState<User>,
>(env: Env, user: User, state: State): Promise<void> {
  const actor = actorFor(user);
  state.authUser = user.authUser ?? (await ensureUser(env, user, { who: actor }));
  state.requestedBy = requestActor(state);
}
