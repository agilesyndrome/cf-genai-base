export type DomainAuth = "public" | "user" | "admin";

export interface DomainRequestContext<Env = unknown, State = unknown> {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  state: State;
  identity: { isAuthenticated: boolean; isAdmin: boolean; who: string };
  params: Readonly<Record<string, string>>;
}

export type DomainPolicy<Env = unknown, State = unknown> = (
  context: DomainRequestContext<Env, State>,
) => boolean | Response | Promise<boolean | Response>;

export type DomainHandler<Env = unknown, State = unknown> = (
  context: DomainRequestContext<Env, State>,
) => Response | Promise<Response>;

export interface DomainRoute<Env = unknown, State = unknown> {
  method: string | readonly string[];
  path: string;
  auth: DomainAuth;
  scopes: readonly string[];
  scopeMode: "all" | "any";
  csrf: boolean;
  authorize?(context: DomainRequestContext<Env, State>): boolean | Response | Promise<boolean | Response>;
  handler(context: DomainRequestContext<Env, State>): Response | Promise<Response>;
  domain: string;
}

export interface DomainRouteInput<Env = unknown, State = unknown>
  extends Omit<
    DomainRoute<Env, State>,
    "path" | "domain" | "auth" | "scopes" | "scopeMode" | "csrf"
  > {
  path?: string;
  /** Use only for a deliberate alias outside the domain's normal base path. */
  absolutePath?: string;
  auth?: DomainAuth;
  scopes?: string | readonly string[];
  scopeMode?: "all" | "any";
  csrf?: boolean;
}

export type DomainView<Props = unknown, Result = unknown> = (props: Props) => Result;
