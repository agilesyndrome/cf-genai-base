import type { CanonicalAuthUser, RequestUser } from "../identity/index.js";

export interface AuthUser extends CanonicalAuthUser {
  provider: string;
  subject: string;
  created_at?: string;
  updated_at?: string;
}

export interface AuthorizationUser extends AuthUser {
  scopes: string[];
  groups: Array<{ group_name: string; granted_at?: string }>;
  tenants: Array<{ id: string; name: string; created_at?: string; updated_at?: string }>;
}

export interface UserIdentityInput extends RequestUser {
  sub: string;
}

export interface UserServiceOptions {
  who?: string;
}

export interface ScopeGrantRow {
  user_id: string;
  scope_name: string;
}

export interface TenantMembershipRow {
  user_id: string;
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface GroupMembershipRow {
  user_id: string;
  group_name: string;
  granted_at?: string;
}
