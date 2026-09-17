/** Serializable tenant record. It intentionally has no framework behavior. */
export interface AuthTenant {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  user_count?: number;
}

export interface NewAuthTenant {
  id: string;
  name: string;
}

export interface TenantUser {
  id: string;
  email?: string | null;
  display_name?: string | null;
  joined_at?: string;
}

export interface TenantAuthorizationState {
  user?: { auth_strategy?: string } | null;
  authUser?: { is_admin?: boolean } | null;
}
