import { createD1 } from "../core/d1.js";
import { deepEqual, parseJsonValue } from "./encoding.js";
import { SubscriptionError } from "./constants.js";

const manifestPromises = new WeakMap();

export async function listTenantSubscriptions(env, tenantId, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare("SELECT s.id,s.name,s.created_at,s.updated_at FROM auth_subscriptions s JOIN auth_tenant_subscriptions ts ON ts.subscription_id=s.id WHERE ts.tenant_id=? ORDER BY s.name COLLATE NOCASE").bind(tenantId).all();
  return Promise.all((results || []).map(async (subscription) => ({ ...subscription, entitlements: await listSubscriptionEntitlements(env, subscription.id, { who }) })));
}

export async function listSubscriptionEntitlements(env, subscriptionId, { who = "system:read" } = {}) {
  const { results } = await createD1(env, { who }).prepare("SELECT entitlement,value_json FROM auth_subscription_entitlements WHERE subscription_id=? ORDER BY entitlement").bind(subscriptionId).all();
  return (results || []).map((row) => ({ entitlement: row.entitlement, value: parseJsonValue(row.value_json) }));
}

export function normalizeSubscriptionManifest(manifest = []) { return manifest.map((subscription) => ({ id: String(subscription?.id || "").trim(), name: String(subscription?.name || subscription?.id || "").trim(), entitlements: Object.fromEntries(Object.entries(subscription?.entitlements || {}).map(([key, value]) => [String(key), value])) })).filter((subscription) => /^[a-z0-9][a-z0-9_-]*$/.test(subscription.id) && subscription.name); }

export async function ensureSubscriptionManifest(env, manifest = [], { who = "system:update" } = {}) {
  if (!env?.DB) return;
  const normalized = normalizeSubscriptionManifest(manifest);
  const key = JSON.stringify(normalized);
  let registrations = manifestPromises.get(env.DB);
  if (!registrations) { registrations = new Map(); manifestPromises.set(env.DB, registrations); }
  let promise = registrations.get(key);
  if (!promise) {
    promise = writeSubscriptionManifest(env, normalized, who);
    registrations.set(key, promise);
    promise.catch(() => registrations.delete(key));
  }
  return promise;
}

async function writeSubscriptionManifest(env, manifest, who) {
  const db = createD1(env, { who });
  for (const subscription of manifest) { await db.prepare("INSERT INTO auth_subscriptions (id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=CURRENT_TIMESTAMP").bind(subscription.id, subscription.name).run(); for (const [entitlement, value] of Object.entries(subscription.entitlements)) await db.prepare("INSERT INTO auth_subscription_entitlements (subscription_id,entitlement,value_json) VALUES (?,?,?) ON CONFLICT(subscription_id,entitlement) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP").bind(subscription.id, entitlement, JSON.stringify(value)).run(); }
}

export async function hasSubscription(env, tenantId, subscriptionId, { who = "system:read" } = {}) { return Boolean(await createD1(env, { who }).prepare("SELECT 1 FROM auth_tenant_subscriptions WHERE tenant_id=? AND subscription_id=?").bind(tenantId, subscriptionId).first()); }
export async function requireSubscription(env, tenantId, subscriptionId, { who = "system:read" } = {}) { if (!await hasSubscription(env, tenantId, subscriptionId, { who })) throw new SubscriptionError("Required subscription is not active for this tenant."); return true; }
export async function hasEntitlement(env, tenantId, entitlement, expectedValue, { who = "system:read" } = {}) { const rows = await createD1(env, { who }).prepare("SELECT e.value_json FROM auth_subscription_entitlements e JOIN auth_tenant_subscriptions ts ON ts.subscription_id=e.subscription_id WHERE ts.tenant_id=? AND e.entitlement=?").bind(tenantId, entitlement).all(); return (rows.results || []).some((row) => expectedValue === undefined || deepEqual(parseJsonValue(row.value_json), expectedValue)); }
export async function requireEntitlement(env, tenantId, entitlement, expectedValue, { who = "system:read" } = {}) { if (!await hasEntitlement(env, tenantId, entitlement, expectedValue, { who })) throw new SubscriptionError(`Required entitlement is not active: ${entitlement}.`); return true; }
