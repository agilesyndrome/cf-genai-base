import { createD1 } from "../core/d1.js";
import { AUTH_GRANT_TABLE, AUTH_USER_TABLE, DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME } from "./constants.js";

export async function ensureUser(env, user, { who = "system:read" } = {}) {
  if (!env?.DB || !user?.sub) return null;
  const db = createD1(env, { who }); const provider = String(user.auth_strategy || "oauth"); const subject = String(user.sub); const email = String(user.email || "").trim().toLowerCase(); const displayName = String(user.name || email || subject);
  const existing = await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE provider=? AND subject=?`).bind(provider, subject).first();
  if (existing) {
    if (existing.email !== email || existing.display_name !== displayName) await db.prepare(`UPDATE ${AUTH_USER_TABLE} SET email=?,display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(email, displayName, existing.id).run();
    return { ...existing, email, display_name: displayName, is_admin: Boolean(existing.is_admin) };
  }
  const id = await stableId(`${provider}:${subject}`);
  await db.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id,provider,subject,email,display_name,is_admin) VALUES (?,?,?,?,?,0) ON CONFLICT(provider,subject) DO NOTHING`).bind(id, provider, subject, email, displayName).run();
  await ensureDefaultTenantMembership(db, id);
  return db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(id).first();
}

async function ensureDefaultTenantMembership(db, userId) { await db.batch([db.prepare("INSERT OR IGNORE INTO auth_tenants (id,name) VALUES (?,?)").bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME), db.prepare("INSERT OR IGNORE INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, DEFAULT_TENANT_ID)]); }

export async function hasScope(env, user, scope, { who = "system:read" } = {}) {
  const db = createD1(env, { who }); if (user?.auth_strategy === "http_basic") return true; const authUser = user?.authUser || await ensureUser(env, user, { who }); if (!authUser) return false; if (Boolean(authUser.is_admin)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM ${AUTH_GRANT_TABLE} WHERE user_id=? AND scope_name=?`).bind(authUser.id, scope).first());
}

export async function listAuthorizationUsers(env, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const [{ results: users = [] }, { results: grants = [] }, { results: memberships = [] }] = await Promise.all([
    db.prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} ORDER BY email COLLATE NOCASE`).all(),
    db.prepare(`SELECT user_id,scope_name FROM ${AUTH_GRANT_TABLE} ORDER BY user_id,scope_name`).all(),
    db.prepare("SELECT ut.user_id,t.id,t.name,t.created_at,t.updated_at FROM auth_user_tenants ut JOIN auth_tenants t ON t.id=ut.tenant_id ORDER BY ut.user_id,t.name COLLATE NOCASE").all(),
  ]);
  const scopesByUser = groupRows(grants, "user_id", (grant) => grant.scope_name);
  const tenantsByUser = groupRows(memberships, "user_id", ({ user_id: _userId, ...tenant }) => tenant);
  return users.map((user) => ({ ...user, scopes: scopesByUser.get(user.id) || [], tenants: tenantsByUser.get(user.id) || [] }));
}

export async function getAuthorizationUser(env, userId, { who = "system:read" } = {}) { return createD1(env, { who }).prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(userId).first(); }

async function stableId(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32); }
function groupRows(rows, key, map) { const grouped = new Map(); for (const row of rows) { const values = grouped.get(row[key]) || []; values.push(map(row)); grouped.set(row[key], values); } return grouped; }
