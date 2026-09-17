import { authGroups } from "./groups/domain.js";
import { authScopes } from "./scopes/domain.js";
import { authTenants } from "./tenants/domain.js";
import { authUsers } from "./users/domain.js";
import { authImpersonation } from "./impersonation/domain.js";
/** Platform-owned domains are installed in every Worker; application domains append to these. */
export const AUTH_DOMAINS = [authGroups, authScopes, authTenants, authUsers, authImpersonation] as const;
