import { createD1 } from "../core/d1.js";
import { AUTH_GRANT_TABLE, AUTH_SCOPE_TABLE } from "./constants.js";

export function normalizeScopes(scopes = []) {
  return scopes.map((scope) => typeof scope === "string" ? { name: scope, label: scope, description: "", system: false } : scope)
    .filter((scope) => scope && /^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(String(scope.name || "")))
    .map((scope) => ({ name: String(scope.name), label: String(scope.label || scope.name), description: String(scope.description || ""), system: Boolean(scope.system) }));
}

export async function ensureScopes(env, scopes = [], { who = "system:read" } = {}) {
  if (!env?.DB) return;
  const db = createD1(env, { who });
  for (const scope of normalizeScopes(scopes)) await db.prepare(`INSERT INTO ${AUTH_SCOPE_TABLE} (name,label,description,system) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET label=excluded.label,description=excluded.description,system=excluded.system`).bind(scope.name, scope.label, scope.description, scope.system ? 1 : 0).run();
}

export async function listAuthorizationScopes(env, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare(`SELECT name,label,description,system FROM ${AUTH_SCOPE_TABLE} ORDER BY name`).all();
  return results;
}

export async function listUserGrants(env, userId, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare(`SELECT scope_name,granted_at FROM ${AUTH_GRANT_TABLE} WHERE user_id=? ORDER BY scope_name`).bind(userId).all();
  return results;
}

export async function replaceUserGrants(env, userId, scopes, grantedBy, { who = "system:read" } = {}) {
  const valid = new Set((await listAuthorizationScopes(env, { who })).map((scope) => scope.name));
  const db = createD1(env, { who });
  const requested = [...new Set(scopes)].filter((scope) => valid.has(scope));
  await db.batch([db.prepare(`DELETE FROM ${AUTH_GRANT_TABLE} WHERE user_id=?`).bind(userId), ...requested.map((scope) => db.prepare(`INSERT INTO ${AUTH_GRANT_TABLE} (user_id,scope_name,granted_by) VALUES (?,?,?)`).bind(userId, scope, grantedBy || null))]);
  return requested;
}
