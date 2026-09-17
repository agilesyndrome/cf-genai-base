import { createD1 } from "../../core/database/index.js";
import { AUTH_GRANT_TABLE } from "../constants.js";
import { validateGroupNames } from "../groups/validation.js";
import { validateScopeNames } from "../scopes/validation.js";
import { validateTenantIds } from "../tenants/validation.js";
import { validateUserId } from "./validation.js";

export interface UserAccessInput {
  groups: readonly unknown[];
  tenants: readonly unknown[];
  scopes: readonly unknown[];
}

export async function replaceUserAccess(
  env: unknown,
  userIdValue: unknown,
  input: UserAccessInput,
  grantedBy?: string | null,
  { who = "system:update" } = {},
): Promise<void> {
  const userId = validateUserId(userIdValue);
  const groups = validateGroupNames(input.groups);
  const tenants = validateTenantIds(input.tenants);
  const scopes = validateScopeNames(input.scopes);
  const db = createD1(env, { who });

  const [user, groupRows, tenantRows, scopeRows] = await Promise.all([
    db.prepare("SELECT id FROM auth_users WHERE id=?").bind(userId).first<{ id: string }>(),
    selectIds(db, "auth_groups", "name", groups),
    selectIds(db, "auth_tenants", "id", tenants),
    selectScopes(db, scopes),
  ]);
  if (!user) throw new TypeError("User does not exist.");
  if (groupRows.size !== groups.length) throw new TypeError("One or more groups do not exist.");
  if (tenantRows.size !== tenants.length) throw new TypeError("One or more tenants do not exist.");
  if (scopeRows.size !== scopes.length) throw new TypeError("One or more scopes do not exist.");
  const protectedScopes = scopes.filter((scope) => scopeRows.get(scope));
  if (protectedScopes.length) throw new TypeError(`System scopes cannot be assigned directly: ${protectedScopes.join(", ")}`);

  await db.batch([
    db.prepare("DELETE FROM auth_user_groups WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM auth_user_tenants WHERE user_id=?").bind(userId),
    db.prepare(`DELETE FROM ${AUTH_GRANT_TABLE} WHERE user_id=?`).bind(userId),
    ...groups.map((group) => db.prepare("INSERT INTO auth_user_groups (user_id,group_name,granted_by) VALUES (?,?,?)").bind(userId, group, grantedBy || null)),
    ...tenants.map((tenant) => db.prepare("INSERT INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, tenant)),
    ...scopes.map((scope) => db.prepare(`INSERT INTO ${AUTH_GRANT_TABLE} (user_id,scope_name,granted_by) VALUES (?,?,?)`).bind(userId, scope, grantedBy || null)),
  ]);
}

async function selectIds(db: D1Database, table: string, column: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${column} IN (${placeholders})`).bind(...ids).all<{ id: string }>();
  return new Set(result.results.map((row) => row.id));
}

async function selectScopes(db: D1Database, scopes: readonly string[]): Promise<Map<string, boolean>> {
  if (!scopes.length) return new Map();
  const placeholders = scopes.map(() => "?").join(",");
  const result = await db.prepare(`SELECT name,system FROM auth_scopes WHERE name IN (${placeholders})`).bind(...scopes).all<{ name: string; system: number | boolean }>();
  return new Map(result.results.map((row) => [row.name, Boolean(row.system)]));
}
