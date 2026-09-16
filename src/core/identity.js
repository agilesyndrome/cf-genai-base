import { Event, emitEvent } from "./events.js";

export function requestActor(state = {}) {
  if (state.requestedBy) return String(state.requestedBy);
  const canonical = authUser(state);
  if (canonical?.id) return `user:${canonical.id}`;
  if (state.user?.auth_strategy === "http_basic") return "user:admin";
  if (state.user?.sub) return `user:${state.user.sub}`;
  return "system:read";
}

export function authUser(value) {
  return value?.authUser || value?.user?.authUser || value?.state?.authUser || value?.state?.user?.authUser || (value?.id && value?.provider && value?.subject ? value : null) || null;
}

export function userId(value) {
  return authUser(value)?.id || value?.userId || value?.sub || value?.email || null;
}

export function requestIdentity(state = {}) {
  const canonical = authUser(state);
  return {
    user: state.user || null,
    authUser: canonical,
    userId: canonical?.id || null,
    who: requestActor(state),
    isAuthenticated: Boolean(canonical || state.user),
    isAdmin: Boolean(state.user?.auth_strategy === "http_basic" || canonical?.is_admin),
  };
}

export function requestContext({ request, env, ctx, state, data } = {}) {
  const identity = requestIdentity(state);
  return {
    request, env, ctx, state, data: data || state?.data,
    ...identity,
    event: (what, where = "application", details = {}, when = new Date()) => emitEvent(env, Event(identity.who, what, where, when, details), ctx),
  };
}
