import { createD1 } from "./core.js";

export const AUTH_USER_TABLE = "auth_users";
export const AUTH_SCOPE_TABLE = "auth_scopes";
export const AUTH_GRANT_TABLE = "auth_user_scopes";

export function normalizeScopes(scopes = []) {
  return scopes.map((scope) => typeof scope === "string" ? { name: scope, label: scope, description: "", system: false } : scope)
    .filter((scope) => scope && /^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(String(scope.name || "")))
    .map((scope) => ({ name: String(scope.name), label: String(scope.label || scope.name), description: String(scope.description || ""), system: Boolean(scope.system) }));
}

export async function ensureScopes(env, scopes = [], { who = "system:read" } = {}) {
  if (!env?.DB) return;
  const db = createD1(env, { who });
  for (const scope of normalizeScopes(scopes)) {
    await db.prepare(`INSERT INTO ${AUTH_SCOPE_TABLE} (name,label,description,system) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET label=excluded.label,description=excluded.description,system=excluded.system`).bind(scope.name, scope.label, scope.description, scope.system ? 1 : 0).run();
  }
}

export async function ensureUser(env, user, { who = "system:read" } = {}) {
  if (!env?.DB || !user?.sub) return null;
  const db = createD1(env, { who });
  const provider = String(user.auth_strategy || "oauth");
  const subject = String(user.sub);
  const email = String(user.email || "").trim().toLowerCase();
  const existing = await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE provider=? AND subject=?`).bind(provider, subject).first();
  const bootstrap = new Set(String(env.AUTH_ADMIN_EMAILS || env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (existing) {
    await db.prepare(`UPDATE ${AUTH_USER_TABLE} SET email=?,display_name=?,is_admin=CASE WHEN is_admin=1 OR ? THEN 1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(email, String(user.name || email || subject), bootstrap.has(email) ? 1 : 0, existing.id).run();
    return { ...existing, email, display_name: String(user.name || email || subject), is_admin: Boolean(existing.is_admin || bootstrap.has(email)) };
  }
  const id = await stableId(`${provider}:${subject}`);
  await db.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id,provider,subject,email,display_name,is_admin) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,subject) DO NOTHING`).bind(id, provider, subject, email, String(user.name || email || subject), bootstrap.has(email) ? 1 : 0).run();
  return await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(id).first();
}

export async function hasScope(env, user, scope, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  if (user?.auth_strategy === "http_basic") return true;
  const authUser = await ensureUser(env, user, { who });
  if (!authUser) return false;
  if (Boolean(authUser.is_admin)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM ${AUTH_GRANT_TABLE} WHERE user_id=? AND scope_name=?`).bind(authUser.id, scope).first());
}

export async function listAuthorizationUsers(env, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} ORDER BY email COLLATE NOCASE`).all();
  return Promise.all(results.map(async (user) => ({ ...user, scopes: (await listUserGrants(env, user.id, { who })).map((grant) => grant.scope_name) })));
}

export async function listAuthorizationScopes(env, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT name,label,description,system FROM ${AUTH_SCOPE_TABLE} ORDER BY name`).all();
  return results;
}

export async function listGroups(env, { who = "system:read" } = {}) { const db = createD1(env, { who }); const result = await db.prepare("SELECT name,display_name,description,created_at,updated_at FROM auth_groups ORDER BY display_name COLLATE NOCASE").all(); return result.results || []; }

export async function listUserGroups(env, userId, { who = "system:read" } = {}) { const db = createD1(env, { who }); const result = await db.prepare("SELECT group_name,granted_at FROM auth_user_groups WHERE user_id=? ORDER BY group_name").bind(userId).all(); return result.results || []; }

export async function replaceUserGroups(env, userId, groups, grantedBy, { who = "system:read" } = {}) { const db = createD1(env, { who }); await db.batch([db.prepare("DELETE FROM auth_user_groups WHERE user_id=?").bind(userId), ...[...new Set(groups)].map((group) => db.prepare("INSERT INTO auth_user_groups (user_id,group_name,granted_by) VALUES (?,?,?)").bind(userId, group, grantedBy || null))]); return listUserGroups(env, userId, { who }); }

export async function listUserGrants(env, userId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT scope_name,granted_at FROM ${AUTH_GRANT_TABLE} WHERE user_id=? ORDER BY scope_name`).bind(userId).all();
  return results;
}

export async function replaceUserGrants(env, userId, scopes, grantedBy, { who = "system:read" } = {}) {
  const valid = new Set((await listAuthorizationScopes(env, { who })).map((scope) => scope.name));
  const db = createD1(env, { who });
  const requested = [...new Set(scopes)].filter((scope) => valid.has(scope));
  await db.batch([
    db.prepare(`DELETE FROM ${AUTH_GRANT_TABLE} WHERE user_id=?`).bind(userId),
    ...requested.map((scope) => db.prepare(`INSERT INTO ${AUTH_GRANT_TABLE} (user_id,scope_name,granted_by) VALUES (?,?,?)`).bind(userId, scope, grantedBy || null))
  ]);
  return requested;
}

async function stableId(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
