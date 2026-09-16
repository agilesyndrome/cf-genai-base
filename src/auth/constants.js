export const AUTH_USER_TABLE = "auth_users";
export const AUTH_SCOPE_TABLE = "auth_scopes";
export const AUTH_GRANT_TABLE = "auth_user_scopes";
export const DEFAULT_TENANT_ID = "easley-family";
export const DEFAULT_TENANT_NAME = "Easley Family";

export class SubscriptionError extends Error {
  constructor(message) { super(message); this.name = "SubscriptionError"; }
}
