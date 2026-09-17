/** Domain shape for a named authorization group. */
export interface AuthGroup {
  name: string;
  display_name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
}

/** A membership is deliberately separate from the group definition. */
export interface GroupMembership {
  user_id: string;
  group_name: string;
  granted_by?: string | null;
  granted_at?: string;
}

export interface GroupUser {
  id: string;
  email?: string | null;
  display_name?: string | null;
  granted_at?: string;
}

export interface NewAuthGroup {
  name: string;
  display_name: string;
  description?: string;
}

export type GroupId = string;

export interface GroupAuthorizationState {
  user?: { auth_strategy?: string } | null;
  authUser?: { is_admin?: boolean } | null;
}
