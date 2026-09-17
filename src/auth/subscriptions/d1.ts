import { createD1 } from "../../core/database/index.js";
import { parseJsonValue } from "../encoding.js";
import type {
  Subscription,
  SubscriptionEntitlement,
  SubscriptionManifestEntry,
  SubscriptionServiceOptions,
} from "./model.js";

interface EntitlementRow { entitlement: string; value_json: string }
interface EntitlementValueRow { value_json: string }

export async function listSubscriptionRows(
  env: unknown,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT id,name,created_at,updated_at FROM auth_subscriptions ORDER BY name COLLATE NOCASE")
    .all<Subscription>();
  return result.results;
}

export async function getSubscriptionRow(
  env: unknown,
  subscriptionId: string,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<Subscription | null> {
  return createD1(env, { who })
    .prepare("SELECT id,name,created_at,updated_at FROM auth_subscriptions WHERE id=?")
    .bind(subscriptionId)
    .first<Subscription>();
}

export async function listTenantSubscriptionRows(
  env: unknown,
  tenantId: string,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  const result = await createD1(env, { who }).prepare(`
    SELECT s.id,s.name,s.created_at,s.updated_at
    FROM auth_subscriptions s
    JOIN auth_tenant_subscriptions ts ON ts.subscription_id=s.id
    WHERE ts.tenant_id=?
    ORDER BY s.name COLLATE NOCASE
  `).bind(tenantId).all<Subscription>();
  return result.results;
}

export async function listSubscriptionEntitlementRows(
  env: unknown,
  subscriptionId: string,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<SubscriptionEntitlement[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT entitlement,value_json FROM auth_subscription_entitlements WHERE subscription_id=? ORDER BY entitlement")
    .bind(subscriptionId)
    .all<EntitlementRow>();
  return result.results.map((row) => ({
    entitlement: row.entitlement,
    value: parseJsonValue(row.value_json),
  }));
}

export async function writeSubscriptionManifest(
  env: unknown,
  manifest: readonly SubscriptionManifestEntry[],
  who: string,
): Promise<void> {
  const db = createD1(env, { who });
  for (const subscription of manifest) {
    await db.prepare("INSERT INTO auth_subscriptions (id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=CURRENT_TIMESTAMP")
      .bind(subscription.id, subscription.name)
      .run();
    for (const [entitlement, value] of Object.entries(subscription.entitlements)) {
      await db.prepare("INSERT INTO auth_subscription_entitlements (subscription_id,entitlement,value_json) VALUES (?,?,?) ON CONFLICT(subscription_id,entitlement) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP")
        .bind(subscription.id, entitlement, JSON.stringify(value))
      .run();
    }
    const entitlementNames = Object.keys(subscription.entitlements);
    const deleteSql = entitlementNames.length
      ? `DELETE FROM auth_subscription_entitlements WHERE subscription_id=? AND entitlement NOT IN (${entitlementNames.map(() => "?").join(",")})`
      : "DELETE FROM auth_subscription_entitlements WHERE subscription_id=?";
    await db.prepare(deleteSql).bind(subscription.id, ...entitlementNames).run();
  }
}

export async function replaceTenantSubscriptionRows(
  env: unknown,
  tenantId: string,
  subscriptionIds: readonly string[],
  { who = "system:update" }: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  const db = createD1(env, { who });
  if (subscriptionIds.length) {
    const placeholders = subscriptionIds.map(() => "?").join(",");
    const result = await db.prepare(`SELECT id FROM auth_subscriptions WHERE id IN (${placeholders})`)
      .bind(...subscriptionIds)
      .all<{ id: string }>();
    if (result.results.length !== subscriptionIds.length) {
      throw new TypeError("One or more subscriptions do not exist.");
    }
  }
  await db.batch([
    db.prepare("DELETE FROM auth_tenant_subscriptions WHERE tenant_id=?").bind(tenantId),
    ...subscriptionIds.map((subscriptionId) =>
      db.prepare("INSERT INTO auth_tenant_subscriptions (tenant_id,subscription_id) VALUES (?,?)")
        .bind(tenantId, subscriptionId)),
  ]);
  return listTenantSubscriptionRows(env, tenantId, { who });
}

export async function hasSubscriptionRow(
  env: unknown,
  tenantId: string,
  subscriptionId: string,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<boolean> {
  return Boolean(await createD1(env, { who })
    .prepare("SELECT 1 FROM auth_tenant_subscriptions WHERE tenant_id=? AND subscription_id=?")
    .bind(tenantId, subscriptionId)
    .first());
}

export async function listEntitlementValueRows(
  env: unknown,
  tenantId: string,
  entitlement: string,
  { who = "system:read" }: SubscriptionServiceOptions = {},
): Promise<unknown[]> {
  const result = await createD1(env, { who }).prepare(`
    SELECT e.value_json
    FROM auth_subscription_entitlements e
    JOIN auth_tenant_subscriptions ts ON ts.subscription_id=e.subscription_id
    WHERE ts.tenant_id=? AND e.entitlement=?
  `).bind(tenantId, entitlement).all<EntitlementValueRow>();
  return result.results.map((row) => parseJsonValue(row.value_json));
}
