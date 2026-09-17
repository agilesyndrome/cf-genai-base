import { Hono } from "hono";
import { hasScope, requestIdentity } from "../auth/index.js";
import type { IdentityState, RequestIdentity } from "../auth/identity/index.js";
import { json, sameOrigin } from "../core/security/index.js";
import type { DomainAuth } from "../domain/index.js";

const ROUTER_CONTEXT = "__cfgenai_api_context";

export interface RouteRequestContext<Env = unknown, State = IdentityState> {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  state: State;
  route: ApiRoute<Env, State>;
  identity: RequestIdentity;
  params: Readonly<Record<string, string>>;
}

export interface ApiRoute<Env = unknown, State = IdentityState> {
  method: string | readonly string[];
  path: string | ((pathname: string, request: Request) => boolean);
  auth?: DomainAuth;
  scope?: string | null;
  scopes?: readonly string[];
  scopeMode?: "all" | "any";
  csrf?: boolean;
  authorize?: (
    context: RouteRequestContext<Env, State>,
  ) => boolean | Response | Promise<boolean | Response>;
  handler: (context: RouteRequestContext<Env, State>) => Response | Promise<Response>;
}

export interface RouteInput<Env = unknown, State = IdentityState>
  extends Omit<ApiRoute<Env, State>, "method"> {
  method?: string | readonly string[];
}

interface RouterContext<Env, State> {
  env: Env;
  ctx: ExecutionContext;
  state: State;
  matched: boolean;
}

type RouterBindings<Env, State> = Env & {
  [ROUTER_CONTEXT]?: RouterContext<Env, State>;
};

export function defineRoute<Env = unknown, State = IdentityState>(
  {
    method = "GET",
    path,
    auth = "public",
    scope = null,
    csrf = false,
    handler,
    ...rest
  }: RouteInput<Env, State>,
): ApiRoute<Env, State> {
  if (!path || typeof handler !== "function") {
    throw new TypeError("API routes require path and handler");
  }
  const normalizedMethod = Array.isArray(method)
    ? method.map((value) => String(value).toUpperCase())
    : String(method).toUpperCase();
  return { ...rest, method: normalizedMethod, path, auth, scope, csrf, handler };
}

/** Compatibility predicate for callers that need to inspect a route directly. */
export function matchRoute(
  request: Request,
  route: Pick<ApiRoute<never, never>, "method" | "path">,
): boolean {
  const url = new URL(request.url);
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  const methodMatches = methods
    .map((method) => String(method).toUpperCase())
    .includes(request.method.toUpperCase());
  const pathMatches = typeof route.path === "function"
    ? route.path(url.pathname, request)
    : route.path === url.pathname;
  return methodMatches && pathMatches;
}

function createRouteRouter<Env extends object, State extends IdentityState>(
  routes: readonly ApiRoute<Env, State>[],
) {
  const app = new Hono<{ Bindings: RouterBindings<Env, State> }>();

  for (const route of routes) {
    const methods = (Array.isArray(route.method) ? route.method : [route.method])
      .map((method) => String(method).toUpperCase());
    const path = typeof route.path === "string" ? route.path : "*";
    for (const method of methods) app.on(method, path, async (context, next) => {
      if (
        typeof route.path === "function"
        && !route.path(new URL(context.req.url).pathname, context.req.raw)
      ) return next();

      const runtime = context.env[ROUTER_CONTEXT];
      if (!runtime) return context.json({ error: "API router context is missing." }, 500);
      runtime.matched = true;
      const identity = requestIdentity(runtime.state);
      if (route.auth === "user" && !identity.isAuthenticated) {
        return json({ error: "Authentication is required." }, 401);
      }
      if (route.auth === "admin" && !identity.isAdmin) {
        return json({ error: "Administrator access is required." }, 403);
      }
      if (route.csrf && !sameOrigin(context.req.raw)) {
        return json({ error: "A same-origin request is required." }, 403);
      }

      const scopes = route.scopes || (route.scope ? [route.scope] : []);
      if (scopes.length) {
        const checks = await Promise.all(scopes.map((scope) =>
          hasScope(
            runtime.env,
            runtime.state.user
              ?? (runtime.state.authUser ? { authUser: runtime.state.authUser } : null),
            scope,
            { who: identity.who },
          )
        ));
        const allowed = route.scopeMode === "any" ? checks.some(Boolean) : checks.every(Boolean);
        if (!allowed) return json({ error: "Required scope is missing." }, 403);
      }

      const routeContext: RouteRequestContext<Env, State> = {
        request: context.req.raw,
        env: runtime.env,
        ctx: runtime.ctx,
        state: runtime.state,
        route,
        identity,
        params: context.req.param(),
      };
      if (route.authorize) {
        const verdict = await route.authorize(routeContext);
        if (verdict instanceof Response) return verdict;
        if (!verdict) return json({ error: "Access is not permitted." }, 403);
      }
      return route.handler(routeContext);
    });
  }
  return app;
}

export function createRouteDispatcher<Env extends object, State extends IdentityState>(
  routes: readonly ApiRoute<Env, State>[] = [],
) {
  const router = createRouteRouter(routes);
  return async function dispatch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    state: State,
  ): Promise<Response | null> {
    if (!routes.length) return null;
    const routerContext: RouterContext<Env, State> = { env, ctx, state, matched: false };
    const requestEnv: RouterBindings<Env, State> = {
      ...env,
      [ROUTER_CONTEXT]: routerContext,
    };
    const response = await router.fetch(request, requestEnv, ctx);
    return !routerContext.matched && response.status === 404 ? null : response;
  };
}

export async function dispatchRoutes<Env extends object, State extends IdentityState>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  state: State,
  routes: readonly ApiRoute<Env, State>[] = [],
): Promise<Response | null> {
  if (!routes.length) return null;
  return createRouteDispatcher(routes)(request, env, ctx, state);
}
