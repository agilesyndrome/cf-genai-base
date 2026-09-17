import { createD1 } from "../../core/database/index.js";
import type { AuthTenant, NewAuthTenant, TenantUser } from "./model.js";

export interface TenantDatabaseOptions {
  who?: string;
}

export async function listTenantRows(env: unknown, { who = "system:read" }: TenantDatabaseOptions = {}): Promise<AuthTenant[]> {
  const result = await createD1(env, { who }).prepare("SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(ut.user_id) AS user_count FROM auth_tenants t LEFT JOIN auth_user_tenants ut ON ut.tenant_id=t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE").all() as { results?: AuthTenant[] };
  return result.results ?? [];
}

export async function listUserTenantRows(env: unknown, userId: string, { who = "system:read" }: TenantDatabaseOptions = {}): Promise<AuthTenant[]> {
  const result = await createD1(env, { who }).prepare("SELECT t.id,t.name,t.created_at,t.updated_at FROM auth_tenants t JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE ut.user_id=? ORDER BY t.name COLLATE NOCASE").bind(userId).all() as { results?: AuthTenant[] };
  return result.results ?? [];
}

export async function getTenantRow(env: unknown, tenantId: string, { who = "system:read" }: TenantDatabaseOptions = {}): Promise<AuthTenant | null> {
  return await createD1(env, { who }).prepare("SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(ut.user_id) AS user_count FROM auth_tenants t LEFT JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE t.id=? GROUP BY t.id").bind(tenantId).first() as AuthTenant | null;
}

export async function listTenantUserRows(env: unknown, tenantId: string, { who = "system:read" }: TenantDatabaseOptions = {}): Promise<TenantUser[]> {
  const result = await createD1(env, { who }).prepare("SELECT u.id,u.email,u.display_name,ut.joined_at FROM auth_user_tenants ut JOIN auth_users u ON u.id=ut.user_id WHERE ut.tenant_id=? ORDER BY u.display_name COLLATE NOCASE,u.email").bind(tenantId).all() as { results?: TenantUser[] };
  return result.results ?? [];
}

export async function insertTenantRow(env: unknown, tenant: NewAuthTenant, { who = "system:update" }: TenantDatabaseOptions = {}): Promise<AuthTenant | null> {
  await createD1(env, { who }).prepare("INSERT INTO auth_tenants (id,name) VALUES (?,?)").bind(tenant.id, tenant.name).run();
  return getTenantRow(env, tenant.id, { who });
}

export async function updateTenantRow(env: unknown, tenantId: string, name: string, { who = "system:update" }: TenantDatabaseOptions = {}): Promise<AuthTenant | null> {
  await createD1(env, { who }).prepare("UPDATE auth_tenants SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, tenantId).run();
  return getTenantRow(env, tenantId, { who });
}

export async function replaceUserTenantRows(env: unknown, userId: string, tenantIds: readonly string[], { who = "system:update" }: TenantDatabaseOptions = {}): Promise<AuthTenant[]> {
  const db = createD1(env, { who });
  if (tenantIds.length) {
    const placeholders = tenantIds.map(() => "?").join(",");
    const result = await db.prepare(`SELECT id FROM auth_tenants WHERE id IN (${placeholders})`).bind(...tenantIds).all() as { results?: { id: string }[] };
    const found = new Set((result.results ?? []).map((row) => row.id));
    if (found.size !== tenantIds.length) throw new Error("One or more tenants do not exist.");
  }
  await db.batch([
    db.prepare("DELETE FROM auth_user_tenants WHERE user_id=?").bind(userId),
    ...tenantIds.map((tenantId) => db.prepare("INSERT INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, tenantId)),
  ]);
  return listUserTenantRows(env, userId, { who });
}
