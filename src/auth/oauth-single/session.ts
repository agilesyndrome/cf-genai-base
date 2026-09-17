import { ensureUser } from "../users/index.js";
import { OAUTH_SINGLE } from "./constants.js";
import { constantTimeEqual, cookies, decodeBase64Url } from "./cookies.js";
import type { OAuthClaims, OAuthEnvironment, OAuthIdentity, OAuthOptions } from "./model.js";
import { sign } from "./protocol.js";

const decoder = new TextDecoder();

export async function hydrateUser(
  user: OAuthIdentity | null,
  env: OAuthEnvironment,
): Promise<OAuthIdentity | null> {
  if (!user) return user;
  if (!env.DB) throw new Error("OAUTH_SINGLE requires the base DB binding for canonical users");
  const authUser = await ensureUser(env, user, {
    who: `user:${user.sub || "unknown"}`,
  });
  return { ...user, authUser };
}

export async function getSessionUser(
  request: Request,
  env: OAuthEnvironment,
  secretName = "AUTH_SESSION_SECRET",
  sessionName = "__Host-cfgenai_session",
  options: OAuthOptions = {},
): Promise<OAuthIdentity | null> {
  const token = cookies(request)[sessionName];
  if (!token) return null;
  if (options.getSession) return (await options.getSession(token, env, request)) || null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantTimeEqual(signature, await sign(payload, env, secretName, false))) {
    return null;
  }
  try {
    const user = readOAuthIdentity(JSON.parse(decoder.decode(decodeBase64Url(payload))));
    return user && typeof user.exp === "number" && user.exp > Date.now() / 1000 ? user : null;
  } catch {
    return null;
  }
}

export function normalizeUser(claims: OAuthClaims): OAuthIdentity {
  return {
    sub: String(claims.sub || ""),
    email: String(claims.email || "").toLowerCase(),
    name: String(claims.name || claims.email || claims.sub || ""),
    email_verified: claims.email_verified === true,
    auth_strategy: OAUTH_SINGLE,
  };
}

export function sessionIdentity(user: OAuthIdentity | null): OAuthIdentity {
  const { authUser: _authUser, exp: _exp, ...identity } = user || { sub: "" };
  return { ...identity, sub: identity.sub };
}

function readOAuthIdentity(value: unknown): OAuthIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sub = Reflect.get(value, "sub");
  if (typeof sub !== "string" || !sub) return null;
  const input = Object.fromEntries(Object.entries(value));
  const stringField = (key: string): string | undefined =>
    typeof input[key] === "string" ? input[key] : undefined;
  const exp = input.exp;
  if (exp !== undefined && typeof exp !== "number") return null;
  return {
    ...input,
    sub,
    email: stringField("email"),
    name: stringField("name"),
    auth_strategy: stringField("auth_strategy"),
    email_verified: typeof input.email_verified === "boolean" ? input.email_verified : undefined,
    exp,
  };
}

export function publicUser(user: OAuthIdentity | null): Record<string, unknown> | null {
  if (!user?.authUser) return null;
  return {
    id: user.authUser.id,
    email: user.email || user.authUser.email,
    name: user.name || user.authUser.display_name,
    isAdmin: Boolean(user.authUser.is_admin),
  };
}
