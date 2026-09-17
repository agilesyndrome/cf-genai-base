import { BASE_PACKAGE_NAME, BASE_VERSION } from "../constants.js";
import { listCircuitBreakers, registerCircuitBreaker } from "../circuits/service.js";
import type { CircuitBreaker } from "../circuits/model.js";
import type { HealthcheckState } from "../constants.js";
import type {
  FeatureManifest,
  Healthcheck,
  HealthcheckAccessOptions,
  HealthcheckEnvironment,
  NormalizedFeatureManifest,
} from "./model.js";
import { listHealthchecks, registerHealthcheck } from "./service.js";
import { normalizeFeatureManifest } from "./validation.js";

interface FeatureHealth {
  feature: string;
  state: HealthcheckState;
  healthchecks: number;
}

export interface FeatureCatalogItem extends NormalizedFeatureManifest {
  health: HealthcheckState;
  healthchecks: Healthcheck[];
  circuit_breakers: CircuitBreaker[];
  circuit_breaker: CircuitBreaker | null;
}

export async function registerFeatureManifests(
  env: HealthcheckEnvironment,
  features: readonly FeatureManifest[] = [],
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<void> {
  for (const feature of features) {
    if (!feature?.name) throw new TypeError("Feature manifests require a name");

    const name = String(feature.name);
    const declared = typeof feature.healthcheck === "function"
      ? await feature.healthcheck(env, { who })
      : (feature.healthchecks || []);
    const declarations = Array.isArray(declared) ? declared : [declared];
    const healthchecks: Healthcheck[] = [];
    const breakers: CircuitBreaker[] = [];

    for (const healthcheck of declarations) {
      const registered = await registerHealthcheck(
        env,
        { ...healthcheck, feature: healthcheck.feature || name },
        { who },
      );
      if (registered) healthchecks.push(registered);
    }
    for (const breaker of feature.circuitBreakers || []) {
      const registered = await registerCircuitBreaker(
        env,
        { ...breaker, feature: breaker.feature || name },
        { who },
      );
      if (registered) breakers.push(registered);
    }

    await registerCircuitBreaker(env, {
      id: `${name}:rollup`,
      feature: name,
      name: "rollup",
      displayName: `${name} feature`,
      state: "on",
      allowSelfHealing: true,
      healthchecks: healthchecks.map((item) => item.id),
      dependsOnCircuitBreakers: breakers.map((item) => item.id),
    }, { who });
  }
}

export async function listFeatureHealth(
  env: HealthcheckEnvironment,
  options: HealthcheckAccessOptions = {},
): Promise<FeatureHealth[]> {
  const checks = await listHealthchecks(env, options);
  const severity: Record<HealthcheckState, number> = { green: 0, yellow: 1, red: 2 };
  const features = new Map<string, FeatureHealth>();

  for (const check of checks) {
    const current = features.get(check.feature);
    if (!current) {
      features.set(check.feature, { feature: check.feature, state: check.state, healthchecks: 1 });
      continue;
    }
    if (severity[check.state] > severity[current.state]) current.state = check.state;
    current.healthchecks += 1;
  }

  return [...features.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

export async function listFeatureCatalog(
  env: HealthcheckEnvironment,
  features: readonly FeatureManifest[] = [],
  options: HealthcheckAccessOptions = {},
): Promise<FeatureCatalogItem[]> {
  const [healthchecks, circuitBreakers] = await Promise.all([
    listHealthchecks(env, options),
    listCircuitBreakers(env, options),
  ]);
  const manifests = new Map<string, NormalizedFeatureManifest>([["base", {
    feature: "base",
    display_name: "Base platform",
    package_name: BASE_PACKAGE_NAME,
    version: BASE_VERSION,
  }]]);

  for (const feature of features) {
    const manifest = normalizeFeatureManifest(feature);
    manifests.set(manifest.feature, manifest);
  }
  for (const item of healthchecks) {
    if (!manifests.has(item.feature)) {
      manifests.set(item.feature, normalizeFeatureManifest({ name: item.feature }));
    }
  }
  for (const item of circuitBreakers) {
    if (!manifests.has(item.feature)) {
      manifests.set(item.feature, normalizeFeatureManifest({ name: item.feature }));
    }
  }

  const severity: Record<HealthcheckState, number> = { green: 0, yellow: 1, red: 2 };
  const healthState = (items: Healthcheck[]): HealthcheckState =>
    items.reduce<HealthcheckState>(
      (current, item) => severity[item.state] > severity[current] ? item.state : current,
      "green",
    );

  return [...manifests.values()]
    .sort((a, b) => a.feature.localeCompare(b.feature))
    .map((manifest) => {
      const featureHealthchecks = healthchecks.filter((item) => item.feature === manifest.feature);
      const featureBreakers = circuitBreakers.filter((item) => item.feature === manifest.feature);
      return {
        ...manifest,
        health: featureHealthchecks.length ? healthState(featureHealthchecks) : "yellow",
        healthchecks: featureHealthchecks,
        circuit_breakers: featureBreakers,
        circuit_breaker: featureBreakers.find((item) => item.name === "rollup") || null,
      };
    });
}

export { normalizeFeatureManifest } from "./validation.js";

