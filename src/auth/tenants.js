import { createD1 } from "../core/d1.js";

export async function listUserTenants(env, userId, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare("SELECT t.id,t.name,t.created_at,t.updated_at FROM auth_tenants t JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE ut.user_id=? ORDER BY t.name COLLATE NOCASE").bind(userId).all();
  return results || [];
}

export async function listAuthorizationTenants(env, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare("SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(ut.user_id) AS user_count FROM auth_tenants t LEFT JOIN auth_user_tenants ut ON ut.tenant_id=t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE").all();
  return results || [];
}

export async function getAuthorizationTenant(env, tenantId, { who = "system:read" } = {}) { return createD1(env, { who }).prepare("SELECT id,name,created_at,updated_at FROM auth_tenants WHERE id=?").bind(String(tenantId)).first(); }

export async function createAuthorizationTenant(env, tenantId, name, { who = "system:update" } = {}) {
  const id = String(tenantId || "").trim(); const tenantName = String(name || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error("Tenant id must contain lowercase letters, numbers, hyphens, or underscores.");
  if (!tenantName) throw new Error("Tenant name is required.");
  await createD1(env, { who }).prepare("INSERT INTO auth_tenants (id,name) VALUES (?,?)").bind(id, tenantName).run();
  return getAuthorizationTenant(env, id, { who });
}

export async function updateAuthorizationTenant(env, tenantId, name, { who = "system:update" } = {}) {
  const tenantName = String(name || "").trim(); if (!tenantName) throw new Error("Tenant name is required.");
  await createD1(env, { who }).prepare("UPDATE auth_tenants SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(tenantName, String(tenantId)).run();
  return getAuthorizationTenant(env, tenantId, { who });
}

export async function replaceUserTenants(env, userId, tenantIds, { who = "system:update" } = {}) {
  const db = createD1(env, { who }); const requested = [...new Set((tenantIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (requested.length) { const placeholders = requested.map(() => "?").join(","); const { results } = await db.prepare(`SELECT id FROM auth_tenants WHERE id IN (${placeholders})`).bind(...requested).all(); const found = new Set((results || []).map((row) => row.id)); if (found.size !== requested.length) throw new Error("One or more tenants do not exist."); }
  await db.batch([db.prepare("DELETE FROM auth_user_tenants WHERE user_id=?").bind(userId), ...requested.map((tenantId) => db.prepare("INSERT INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, tenantId))]);
  return listUserTenants(env, userId, { who });
}
