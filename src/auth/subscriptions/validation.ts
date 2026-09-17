import type { SubscriptionManifestEntry } from "./model.js";

const SUBSCRIPTION_ID = /^[a-z0-9][a-z0-9_-]*$/;

export function normalizeSubscriptionManifest(manifest: readonly unknown[] = []): SubscriptionManifestEntry[] {
  return manifest
    .map((value) => {
      const subscription = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
      const id = String(subscription.id ?? "").trim();
      const name = String(subscription.name ?? subscription.id ?? "").trim();
      const source = subscription.entitlements && typeof subscription.entitlements === "object"
        ? subscription.entitlements as Record<string, unknown>
        : {};
      return {
        id,
        name,
        entitlements: Object.fromEntries(Object.entries(source).map(([key, value]) => [String(key), value])),
      };
    })
    .filter((subscription) => SUBSCRIPTION_ID.test(subscription.id) && Boolean(subscription.name));
}
