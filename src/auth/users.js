import { createD1 } from "../core/d1.js";
import { AUTH_GRANT_TABLE, AUTH_USER_TABLE, DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME } from "./constants.js";
import { listUserGrants } from "./scopes.js";
import { listUserTenants } from "./tenants.js";

export async function ensureUser(env, user, { who = "system:read" } = {}) {
  if (!env?.DB || !user?.sub) return null;
  const db = createD1(env, { who }); const provider = String(user.auth_strategy || "oauth"); const subject = String(user.sub); const email = String(user.email || "").trim().toLowerCase();
  const existing = await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE provider=? AND subject=?`).bind(provider, subject).first();
  if (existing) { await db.prepare(`UPDATE ${AUTH_USER_TABLE} SET email=?,display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(email, String(user.name || email || subject), existing.id).run(); await ensureDefaultTenantMembership(db, existing.id); return { ...existing, email, display_name: String(user.name || email || subject), is_admin: Boolean(existing.is_admin) }; }
  const id = await stableId(`${provider}:${subject}`);
  await db.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id,provider,subject,email,display_name,is_admin) VALUES (?,?,?,?,?,0) ON CONFLICT(provider,subject) DO NOTHING`).bind(id, provider, subject, email, String(user.name || email || subject)).run();
  await ensureDefaultTenantMembership(db, id);
  return db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(id).first();
}

async function ensureDefaultTenantMembership(db, userId) { await db.batch([db.prepare("INSERT OR IGNORE INTO auth_tenants (id,name) VALUES (?,?)").bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME), db.prepare("INSERT OR IGNORE INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, DEFAULT_TENANT_ID)]); }

export async function hasScope(env, user, scope, { who = "system:read" } = {}) {
  const db = createD1(env, { who }); if (user?.auth_strategy === "http_basic") return true; const authUser = user?.authUser || await ensureUser(env, user, { who }); if (!authUser) return false; if (Boolean(authUser.is_admin)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM ${AUTH_GRANT_TABLE} WHERE user_id=? AND scope_name=?`).bind(authUser.id, scope).first());
}

export async function listAuthorizationUsers(env, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} ORDER BY email COLLATE NOCASE`).all();
  return Promise.all(results.map(async (user) => ({ ...user, scopes: (await listUserGrants(env, user.id, { who })).map((grant) => grant.scope_name), tenants: await listUserTenants(env, user.id, { who }) })));
}

export async function getAuthorizationUser(env, userId, { who = "system:read" } = {}) { return createD1(env, { who }).prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(userId).first(); }

async function stableId(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32); }
