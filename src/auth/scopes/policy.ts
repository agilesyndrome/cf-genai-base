import type { ScopeAuthorizationState } from "./model.js";
export function canManageScopes(state: ScopeAuthorizationState): boolean {
  return state.user?.auth_strategy === "http_basic" || state.authUser?.is_admin === true;
}
