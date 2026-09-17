import type { GroupAuthorizationState } from "./model.js";

/** Group administration is an administrator capability, not a property of the route folder. */
export function canManageGroups(state: GroupAuthorizationState): boolean {
  return state.user?.auth_strategy === "http_basic" || Boolean(state.authUser?.is_admin);
}

export function requireGroupAdministrator(state: GroupAuthorizationState): GroupAuthorizationState["authUser"] {
  return canManageGroups(state) ? state.authUser ?? null : null;
}
