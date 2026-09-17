import { SubscriptionError } from "../constants.js";
import { deepEqual } from "../encoding.js";
import {
  hasSubscriptionRow,
  getSubscriptionRow,
  listSubscriptionRows,
  listEntitlementValueRows,
  listSubscriptionEntitlementRows,
  listTenantSubscriptionRows,
  replaceTenantSubscriptionRows,
  writeSubscriptionManifest,
} from "./d1.js";
import type { Subscription, SubscriptionEntitlement, SubscriptionServiceOptions } from "./model.js";
import { normalizeSubscriptionManifest } from "./validation.js";

const manifestPromises = new WeakMap<object, Map<string, Promise<void>>>();

export async function listSubscriptions(
  env: unknown,
  options: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  const subscriptions = await listSubscriptionRows(env, options);
  return Promise.all(subscriptions.map(async (subscription) => ({
    ...subscription,
    entitlements: await listSubscriptionEntitlements(env, subscription.id, options),
  })));
}

export async function getSubscription(
  env: unknown,
  subscriptionId: string,
  options: SubscriptionServiceOptions = {},
): Promise<Subscription | null> {
  const subscription = await getSubscriptionRow(env, subscriptionId, options);
  return subscription ? {
    ...subscription,
    entitlements: await listSubscriptionEntitlements(env, subscription.id, options),
  } : null;
}

export function replaceTenantSubscriptions(
  env: unknown,
  tenantId: string,
  subscriptionIds: readonly string[],
  options: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  return replaceTenantSubscriptionRows(env, tenantId, [...new Set(subscriptionIds)], options);
}

export async function listTenantSubscriptions(
  env: unknown,
  tenantId: string,
  options: SubscriptionServiceOptions = {},
): Promise<Subscription[]> {
  const subscriptions = await listTenantSubscriptionRows(env, tenantId, options);
  return Promise.all(subscriptions.map(async (subscription) => ({
    ...subscription,
    entitlements: await listSubscriptionEntitlements(env, subscription.id, options),
  })));
}

export function listSubscriptionEntitlements(
  env: unknown,
  subscriptionId: string,
  options: SubscriptionServiceOptions = {},
): Promise<SubscriptionEntitlement[]> {
  return listSubscriptionEntitlementRows(env, subscriptionId, options);
}

export async function ensureSubscriptionManifest(
  env: unknown,
  manifest: readonly unknown[] = [],
  { who = "system:update" }: SubscriptionServiceOptions = {},
): Promise<void> {
  const binding = (env as { DB?: object } | null)?.DB;
  if (!binding) return;
  const normalized = normalizeSubscriptionManifest(manifest);
  const key = JSON.stringify(normalized);
  let registrations = manifestPromises.get(binding);
  if (!registrations) {
    registrations = new Map();
    manifestPromises.set(binding, registrations);
  }
  let registration = registrations.get(key);
  if (!registration) {
    registration = writeSubscriptionManifest(env, normalized, who);
    registrations.set(key, registration);
    registration.catch(() => registrations?.delete(key));
  }
  await registration;
}

export function hasSubscription(
  env: unknown,
  tenantId: string,
  subscriptionId: string,
  options: SubscriptionServiceOptions = {},
): Promise<boolean> {
  return hasSubscriptionRow(env, tenantId, subscriptionId, options);
}

export async function requireSubscription(
  env: unknown,
  tenantId: string,
  subscriptionId: string,
  options: SubscriptionServiceOptions = {},
): Promise<true> {
  if (!await hasSubscription(env, tenantId, subscriptionId, options)) {
    throw new SubscriptionError("Required subscription is not active for this tenant.");
  }
  return true;
}

export async function hasEntitlement(
  env: unknown,
  tenantId: string,
  entitlement: string,
  expectedValue?: unknown,
  options: SubscriptionServiceOptions = {},
): Promise<boolean> {
  const values = await listEntitlementValueRows(env, tenantId, entitlement, options);
  return values.some((value) => expectedValue === undefined || deepEqual(value, expectedValue));
}

export async function requireEntitlement(
  env: unknown,
  tenantId: string,
  entitlement: string,
  expectedValue?: unknown,
  options: SubscriptionServiceOptions = {},
): Promise<true> {
  if (!await hasEntitlement(env, tenantId, entitlement, expectedValue, options)) {
    throw new SubscriptionError(`Required entitlement is not active: ${entitlement}.`);
  }
  return true;
}
