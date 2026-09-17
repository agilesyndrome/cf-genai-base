import { Event, emitEvent } from "../../core/events/index.js";

export interface CanonicalAuthUser {
  id: string;
  provider?: string;
  subject?: string;
  email?: string | null;
  display_name?: string | null;
  is_admin?: boolean | number;
}

export interface RequestUser {
  sub?: string;
  email?: string;
  name?: string;
  auth_strategy?: string;
  authUser?: CanonicalAuthUser | null;
}

export interface IdentityState<Data = unknown> {
  requestedBy?: string;
  user?: RequestUser | null;
  authUser?: CanonicalAuthUser | null;
  userId?: string | null;
  data?: Data;
}

export interface RequestIdentity {
  user: RequestUser | null;
  authUser: CanonicalAuthUser | null;
  userId: string | null;
  who: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

type IdentityLike = IdentityState | RequestUser | CanonicalAuthUser | null | undefined;

export function requestActor(value: unknown = {}): string {
  const state = value as IdentityState;
  if (state.requestedBy) return String(state.requestedBy);
  const canonical = authUser(state);
  if (canonical?.id) return `user:${canonical.id}`;
  if (state.user?.auth_strategy === "http_basic") return "user:admin";
  if (state.user?.sub) return `user:${state.user.sub}`;
  return "system:read";
}

export function authUser(value: IdentityLike): CanonicalAuthUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as IdentityState & RequestUser & CanonicalAuthUser & { state?: IdentityState };
  return candidate.authUser
    ?? candidate.user?.authUser
    ?? candidate.state?.authUser
    ?? candidate.state?.user?.authUser
    ?? (candidate.id && candidate.provider && candidate.subject ? candidate : null);
}

export function userId(value: IdentityLike): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as IdentityState & RequestUser;
  return authUser(value)?.id ?? candidate.userId ?? candidate.sub ?? candidate.email ?? null;
}

export function requestIdentity(state: IdentityState = {}): RequestIdentity {
  const canonical = authUser(state);
  return {
    user: state.user ?? null,
    authUser: canonical,
    userId: canonical?.id ?? null,
    who: requestActor(state),
    isAuthenticated: Boolean(canonical || state.user),
    isAdmin: Boolean(state.user?.auth_strategy === "http_basic" || canonical?.is_admin),
  };
}

interface RequestContextInput<Env, Data, State extends IdentityState<Data>> {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  state: State;
  data?: Data;
}

export function requestContext<
  Env,
  Data = unknown,
  State extends IdentityState<Data> = IdentityState<Data>,
>({
  request,
  env,
  ctx,
  state,
  data,
}: RequestContextInput<Env, Data, State>) {
  const identity = requestIdentity(state);
  return {
    request,
    env,
    ctx,
    state,
    data: data ?? state.data,
    ...identity,
    event: (
      what: string,
      where = "application",
      details: Record<string, unknown> = {},
      when: Date = new Date(),
    ) => emitEvent(env, Event(identity.who, what, where, when, details), ctx),
  };
}
