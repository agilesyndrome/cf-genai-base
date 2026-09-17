import {
  ensureUser,
  getAuthorizationUser,
  listUserGrants,
  listUserTenants,
  verifyImpersonationToken,
} from "../auth/index.js";
import type { CanonicalAuthUser, RequestUser } from "../auth/identity/index.js";
import type { DataActorContext } from "./model.js";

interface DataContextEnvironment {
  AUTH_SESSION_SECRET?: string;
  DB?: D1Database;
  [key: string]: unknown;
}

interface RequestState {
  authUser?: CanonicalAuthUser | null;
  user?: RequestUser | null;
  tenantId?: string;
}

interface ContextOptions {
  state?: RequestState;
  request?: Request;
  publicTenantId?: string | null;
}

export async function requestDataContext(
  env: DataContextEnvironment,
  { state = {}, request, publicTenantId = null }: ContextOptions = {},
): Promise<DataActorContext> {
  let authUser = state.authUser
    || (state.user
      ? await ensureUser(env, state.user, { who: `user:${state.user.sub || "unknown"}` })
      : null);
  const system = Boolean(state.user?.auth_strategy === "http_basic" || authUser?.is_admin);
  if (!authUser) {
    return {
      userId: null,
      displayName: null,
      tenantId: publicTenantId,
      publicTenantId,
      public: Boolean(publicTenantId),
      system: false,
    };
  }

  const token = request?.headers.get("X-CF-GenAI-Impersonation")
    || readCookie(request, "__Host-cfgenai_impersonation");
  const impersonation = system ? await verifyImpersonationToken(token, env) : null;
  if (impersonation) {
    const targetUser = await getAuthorizationUser(env, impersonation.targetUserId, {
      who: `user:${impersonation.adminUserId}`,
    });
    if (targetUser) authUser = targetUser;
  }

  const who = `user:${authUser.id}`;
  const [tenants, grants] = await Promise.all([
    listUserTenants(env, authUser.id, { who }),
    listUserGrants(env, authUser.id, { who }),
  ]);
  const requestedTenant = state.tenantId || request?.headers.get("X-Tenant-ID") || null;
  const tenant = requestedTenant
    ? tenants.find((item) => item.id === requestedTenant)
    : tenants.length === 1 ? tenants[0] : null;

  return {
    userId: authUser.id,
    displayName: authUser.display_name || authUser.email || authUser.id,
    tenantId: tenant?.id || null,
    publicTenantId,
    public: false,
    system,
    scopes: grants.map((grant) => grant.scope_name),
    tenants,
    invalidTenant: Boolean(requestedTenant && !tenant),
    impersonated: Boolean(impersonation),
    impersonatedBy: impersonation?.adminUserId || null,
  };
}

function readCookie(request: Request | undefined, name: string): string {
  const value = request?.headers.get("Cookie") || "";
  return value.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}
