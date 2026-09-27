import { createD1 } from "../../core/database/index.js";
import { AUTH_GRANT_TABLE, AUTH_USER_TABLE } from "../constants.js";
import type {
  AuthUser,
  GroupMembershipRow,
  ScopeGrantRow,
  TenantMembershipRow,
  UserIdentityInput,
  UserServiceOptions,
} from "./model.js";

export interface UserListOptions { email?: string; active?: boolean; limit?: number; offset?: number }

export async function findUserByIdentity(
  env: unknown,
  provider: string,
  subject: string,
  { who = "system:read" }: UserServiceOptions = {},
): Promise<AuthUser | null> {
  return createD1(env, { who })
    .prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE provider=? AND subject=?`)
    .bind(provider, subject)
    .first<AuthUser>();
}

export async function getUserRow(
  env: unknown,
  userId: string,
  { who = "system:read" }: UserServiceOptions = {},
): Promise<AuthUser | null> {
  return createD1(env, { who })
    .prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE id=?`)
    .bind(userId)
    .first<AuthUser>();
}

export async function insertUserRow(
  env: unknown,
  id: string,
  identity: UserIdentityInput,
  options: UserServiceOptions = {},
): Promise<AuthUser | null> {
  const provider = String(identity.auth_strategy ?? "oauth");
  const email = String(identity.email ?? "");
  const displayName = String(identity.name ?? (email || identity.sub));
  const db = createD1(env, { who: options.who ?? "system:update" });
  await db.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id,provider,subject,email,display_name,is_admin) VALUES (?,?,?,?,?,0) ON CONFLICT(provider,subject) DO NOTHING`)
    .bind(id, provider, identity.sub, email, displayName)
    .run();
  return getUserRow(env, id, options);
}

export async function refreshUserIdentity(
  env: unknown,
  user: AuthUser,
  identity: UserIdentityInput,
  { who = "system:update" }: UserServiceOptions = {},
): Promise<AuthUser> {
  const email = String(identity.email ?? "");
  const displayName = String(identity.name ?? (email || identity.sub));
  if (user.email !== email || user.display_name !== displayName) {
    await createD1(env, { who })
      .prepare(`UPDATE ${AUTH_USER_TABLE} SET email=?,display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(email, displayName, user.id)
      .run();
  }
  return { ...user, email, display_name: displayName, is_admin: Boolean(user.is_admin) };
}

export async function listUserRows(
  env: unknown,
  { who = "system:read", email, active, limit = 100, offset = 0 }: UserServiceOptions & UserListOptions = {},
): Promise<{ users: AuthUser[]; grants: ScopeGrantRow[]; memberships: TenantMembershipRow[]; groups: GroupMembershipRow[] }> {
  const db = createD1(env, { who });
  const conditions = email ? ["email LIKE ?"] : [];
  const args: unknown[] = email ? [`%${email}%`] : [];
  if (active !== undefined) { conditions.push("active=?"); args.push(active ? 1 : 0); }
  const suffix = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const userStatement = `SELECT id,email,display_name,provider,subject,is_admin,active,created_at,updated_at FROM ${AUTH_USER_TABLE}${suffix} ORDER BY email COLLATE NOCASE`;
  const userQuery = email || active !== undefined || limit !== 100 || offset !== 0
    ? db.prepare(`${userStatement} LIMIT ? OFFSET ?`).bind(...args, Math.min(500, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0))
    : db.prepare(userStatement);
  const [users, grants, memberships, groups] = await Promise.all([
    userQuery.all<AuthUser>(),
    db.prepare(`SELECT user_id,scope_name FROM ${AUTH_GRANT_TABLE} ORDER BY user_id,scope_name`).all<ScopeGrantRow>(),
    db.prepare("SELECT ut.user_id,t.id,t.name,t.created_at,t.updated_at FROM auth_user_tenants ut JOIN auth_tenants t ON t.id=ut.tenant_id ORDER BY ut.user_id,t.name COLLATE NOCASE").all<TenantMembershipRow>(),
    db.prepare("SELECT user_id,group_name,granted_at FROM auth_user_groups ORDER BY user_id,group_name").all<GroupMembershipRow>(),
  ]);
  return {
    users: users.results,
    grants: grants.results,
    memberships: memberships.results,
    groups: groups.results,
  };
}

export async function userHasScope(
  env: unknown,
  userId: string,
  scope: string,
  { who = "system:read" }: UserServiceOptions = {},
): Promise<boolean> {
  return Boolean(await createD1(env, { who })
    .prepare(`SELECT 1 FROM ${AUTH_GRANT_TABLE} WHERE user_id=? AND scope_name=?`)
    .bind(userId, scope)
    .first());
}
