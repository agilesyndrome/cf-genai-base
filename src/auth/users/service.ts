import type { CanonicalAuthUser, RequestUser } from "../identity/index.js";
import {
  findUserByIdentity,
  getUserRow,
  insertUserRow,
  listUserRows,
  refreshUserIdentity,
  userHasScope,
} from "./d1.js";
import type { AuthorizationUser, AuthUser, UserServiceOptions } from "./model.js";
import { normalizeUserIdentity, validateUserId } from "./validation.js";

export async function ensureUser(
  env: unknown,
  value: unknown,
  options: UserServiceOptions = {},
): Promise<AuthUser | null> {
  if (!env || typeof env !== "object" || !Reflect.get(env, "DB")) return null;
  const identity = normalizeUserIdentity(value);
  if (!identity) return null;
  const provider = String(identity.auth_strategy ?? "oauth");
  const existing = await findUserByIdentity(env, provider, identity.sub, options);
  if (existing) return refreshUserIdentity(env, existing, identity, options);
  return insertUserRow(env, await stableId(`${provider}:${identity.sub}`), identity, options);
}

export async function hasScope(
  env: unknown,
  user: RequestUser | CanonicalAuthUser | null | undefined,
  scope: string,
  options: UserServiceOptions = {},
): Promise<boolean> {
  if (user && "auth_strategy" in user && user.auth_strategy === "http_basic") return true;
  const canonical = isCanonicalAuthUser(user)
    ? user
    : user?.authUser ?? await ensureUser(env, user, options);
  if (!canonical) return false;
  if (Boolean(canonical.is_admin)) return true;
  return userHasScope(env, canonical.id, scope, options);
}

function isCanonicalAuthUser(
  value: RequestUser | CanonicalAuthUser | null | undefined,
): value is CanonicalAuthUser {
  return Boolean(value && "id" in value && typeof value.id === "string" && value.id);
}

export async function listAuthorizationUsers(
  env: unknown,
  options: UserServiceOptions = {},
): Promise<AuthorizationUser[]> {
  const { users, grants, memberships, groups } = await listUserRows(env, options);
  const scopesByUser = groupRows(grants, "user_id", (grant) => grant.scope_name);
  const tenantsByUser = groupRows(memberships, "user_id", ({ user_id: _userId, ...tenant }) => tenant);
  const groupsByUser = groupRows(groups, "user_id", ({ user_id: _userId, ...group }) => group);
  return users.map((user) => ({
    ...user,
    scopes: scopesByUser.get(user.id) ?? [],
    groups: groupsByUser.get(user.id) ?? [],
    tenants: tenantsByUser.get(user.id) ?? [],
  }));
}

export function getAuthorizationUser(
  env: unknown,
  userId: unknown,
  options: UserServiceOptions = {},
): Promise<AuthUser | null> {
  return getUserRow(env, validateUserId(userId), options);
}

async function stableId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function groupRows<Row, Key extends keyof Row, Value>(
  rows: readonly Row[],
  key: Key,
  map: (row: Row) => Value,
): Map<string, Value[]> {
  const grouped = new Map<string, Value[]>();
  for (const row of rows) {
    const group = String(row[key]);
    const values = grouped.get(group) ?? [];
    values.push(map(row));
    grouped.set(group, values);
  }
  return grouped;
}
