import type { TenantAuthorizationState } from "./model.js";

export function canManageTenants(state: TenantAuthorizationState): boolean {
  return state.user?.auth_strategy === "http_basic" || Boolean(state.authUser?.is_admin);
}
