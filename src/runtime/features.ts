import { evaluateCircuitBreaker, listCircuitBreakers } from "../core/circuits/index.js";
import { registerFeatureManifests } from "../core/healthchecks/index.js";
import type { FeatureManifest } from "../core/healthchecks/model.js";
import type { FeatureManifestOptions, RuntimeBindings } from "./model.js";

const featureRegistrationPromises = new WeakMap<
  D1Database,
  Map<string, Promise<void>>
>();

/**
 * Registration is idempotent per D1 binding and feature set. The cache only avoids
 * duplicate work inside a warm isolate; D1 remains the durable source of truth.
 */
export function ensureFeatureManifests(
  env: RuntimeBindings,
  features: readonly FeatureManifest[] = [],
  { who = "system:update" }: FeatureManifestOptions = {},
): Promise<void> {
  if (!env || typeof env !== "object" || !env.DB) return Promise.resolve();
  const key = features.map((feature) => String(feature?.name || "feature")).join("|");
  let registrations = featureRegistrationPromises.get(env.DB);
  if (!registrations) {
    registrations = new Map();
    featureRegistrationPromises.set(env.DB, registrations);
  }

  let promise = registrations.get(key);
  if (!promise) {
    promise = (async () => {
      await registerFeatureManifests(env, features, { who });
      const breakers = await listCircuitBreakers(env, { who });
      await Promise.all(
        breakers.map((breaker) => evaluateCircuitBreaker(env, breaker.id, { who })),
      );
    })();
    registrations.set(key, promise);
    promise.catch(() => registrations?.delete(key));
  }
  return promise;
}

