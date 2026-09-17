import { createD1 } from "../../core/database/index.js";
import { AUTH_GRANT_TABLE, AUTH_SCOPE_TABLE } from "../constants.js";
import type { AuthScope, UserGrant } from "./model.js";
import { normalizeScopes } from "./validation.js";

export async function ensureScopes(
  env: unknown,
  scopes: readonly unknown[] = [],
  { who = "system:read" } = {},
): Promise<void> {
  if (!(env as { DB?: unknown })?.DB) return;
  const db = createD1(env, { who });
  for (const scope of normalizeScopes(scopes)) {
    await db.prepare(`
      INSERT INTO ${AUTH_SCOPE_TABLE} (name,label,description,system)
      VALUES (?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET
        label=excluded.label,
        description=excluded.description,
        system=excluded.system
    `).bind(scope.name, scope.label, scope.description, scope.system ? 1 : 0).run();
  }
}

export async function listAuthorizationScopes(
  env: unknown,
  { who = "system:read" } = {},
): Promise<AuthScope[]> {
  const result = await createD1(env, { who })
    .prepare(`SELECT name,label,description,system FROM ${AUTH_SCOPE_TABLE} ORDER BY name`)
    .all() as { results?: AuthScope[] };
  return result.results ?? [];
}

export async function getAuthorizationScope(
  env: unknown,
  name: string,
  { who = "system:read" } = {},
): Promise<AuthScope | null> {
  return createD1(env, { who })
    .prepare(`SELECT name,label,description,system FROM ${AUTH_SCOPE_TABLE} WHERE name=?`)
    .bind(name)
    .first<AuthScope>();
}

export async function listUserGrants(
  env: unknown,
  userId: string,
  { who = "system:read" } = {},
): Promise<UserGrant[]> {
  const result = await createD1(env, { who })
    .prepare(`SELECT scope_name,granted_at FROM ${AUTH_GRANT_TABLE} WHERE user_id=? ORDER BY scope_name`)
    .bind(userId)
    .all() as { results?: UserGrant[] };
  return result.results ?? [];
}

export async function replaceUserGrants(
  env: unknown,
  userId: string,
  scopes: readonly string[],
  grantedBy: string | null | undefined,
  { who = "system:read" } = {},
): Promise<string[]> {
  const catalog = await listAuthorizationScopes(env, { who });
  const valid = new Map(catalog.map((scope) => [scope.name, scope]));
  const requested = [...new Set(scopes)];
  const unknown = requested.filter((scope) => !valid.has(scope));
  if (unknown.length) throw new TypeError(`Unknown scopes: ${unknown.join(", ")}`);
  const protectedScopes = requested.filter((scope) => Boolean(valid.get(scope)?.system));
  if (protectedScopes.length) {
    throw new TypeError(`System scopes cannot be assigned directly: ${protectedScopes.join(", ")}`);
  }
  const db = createD1(env, { who });
  await db.batch([
    db.prepare(`DELETE FROM ${AUTH_GRANT_TABLE} WHERE user_id=?`).bind(userId),
    ...requested.map((scope) =>
      db.prepare(`INSERT INTO ${AUTH_GRANT_TABLE} (user_id,scope_name,granted_by) VALUES (?,?,?)`)
        .bind(userId, scope, grantedBy || null),
    ),
  ]);
  return requested;
}
