import { evaluateCircuitBreaker, listCircuitBreakers, registerFeatureManifests } from "../core/circuits.js";

const featureRegistrationPromises = new WeakMap();

export function ensureFeatureManifests(env, features = [], { who = "system:update" } = {}) {
  if (!env || typeof env !== "object" || !env.DB) return Promise.resolve();
  const key = features.map((feature) => String(feature?.name || feature?.id || "feature")).join("|");
  let registrations = featureRegistrationPromises.get(env.DB);
  if (!registrations) { registrations = new Map(); featureRegistrationPromises.set(env.DB, registrations); }
  let promise = registrations.get(key);
  if (!promise) {
    promise = (async () => { await registerFeatureManifests(env, features, { who }); const breakers = await listCircuitBreakers(env, { who }); await Promise.all(breakers.filter(Boolean).map((breaker) => evaluateCircuitBreaker(env, breaker.id, { who }))); })();
    registrations.set(key, promise);
    promise.catch(() => registrations.delete(key));
  }
  return promise;
}
