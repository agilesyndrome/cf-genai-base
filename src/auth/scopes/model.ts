export interface AuthScope { name: string; label: string; description: string; system: boolean }
export interface NewAuthScope { name: string; label?: string; description?: string; system?: boolean }
export interface UserGrant { scope_name: string; granted_at?: string }
export interface ScopeAuthorizationState { user?: { auth_strategy?: string } | null; authUser?: { is_admin?: boolean } | null }
