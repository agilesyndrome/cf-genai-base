import {
  authenticateAdminRequest,
  authenticationRequired,
  administratorRequired,
  isAdminPath,
  prepareAdminState,
  requireSameOriginMutation,
} from "./auth.js";
import type {
  AdminBindings,
  AdminBoundaryOptions,
  AdminIdentity,
  AdminRequestState,
  AdminNext,
} from "./types.js";

export const ADMIN_API_PREFIX = "/api/admin";

export async function adminBoundary<
  Env extends AdminBindings,
  User extends AdminIdentity,
  State extends AdminRequestState<User>,
  Feature extends object = object,
>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  next: AdminNext,
  state: State,
  options: AdminBoundaryOptions<Env, User, State, Feature>,
): Promise<Response> {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return next(request);

  const authenticationFailure = await authenticateAdminRequest(request, env, url, state, options.provider);
  if (authenticationFailure) return authenticationFailure;
  const originFailure = requireSameOriginMutation(request, url);
  if (originFailure) return originFailure;

  const user = state.user;
  if (!user) return authenticationRequired(request);
  await prepareAdminState(env, user, state);

  const policyAllowed = !options.authorize || user.auth_strategy === "http_basic" || (await options.authorize({ request, url, user, env, ctx, state }));
  if (!policyAllowed) return administratorRequired(url);

  // Domain routes own dispatch. This boundary only establishes identity and
  // application-wide admin policy before the request reaches Hono.
  return next(request);
}
