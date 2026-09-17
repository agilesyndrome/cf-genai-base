/** The small binding contract used by the reusable admin boundary. */
export interface AdminBindings {
  AUTH_STRATEGY?: string;
  ADMIN_TOKEN?: string;
  DB?: D1Database;
}

export interface AdminAuthorizationUser {
  id: string;
  email?: string | null;
  display_name?: string | null;
  is_admin?: boolean | number;
}

export interface AdminIdentity {
  sub: string;
  email?: string;
  name?: string;
  roles?: readonly string[];
  auth_strategy?: string;
  authUser?: AdminAuthorizationUser | null;
}

export interface AdminRequestState<User extends AdminIdentity = AdminIdentity> {
  user?: User | null;
  authUser?: AdminAuthorizationUser | null;
  requestedBy?: string;
}

export interface AdminUserProvider<Env extends AdminBindings, User extends AdminIdentity> {
  getUser(request: Request, env: Env): User | null | Promise<User | null>;
}

export interface AdminAuthorizationContext<
  Env extends AdminBindings,
  User extends AdminIdentity,
  State extends AdminRequestState<User>,
> {
  request: Request;
  url: URL;
  user: User;
  env: Env;
  ctx: ExecutionContext;
  state: State;
}

export interface AdminBoundaryOptions<
  Env extends AdminBindings,
  User extends AdminIdentity,
  State extends AdminRequestState<User>,
  Feature extends object = object,
> {
  provider?: AdminUserProvider<Env, User> | null;
  authorize?: (
    context: AdminAuthorizationContext<Env, User, State>,
  ) => boolean | Promise<boolean>;
  features?: readonly Feature[];
}

export type AdminNext = (request: Request) => Response | Promise<Response>;
