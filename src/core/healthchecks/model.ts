import type { HealthcheckState } from "../constants.js";

export interface HealthcheckInput {
  id?: string;
  feature?: string;
  component?: string;
  displayName?: string;
  state?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedHealthcheck {
  feature: string;
  component: string;
  displayName: string;
  state: HealthcheckState;
  metadata: Record<string, unknown>;
}

export interface HealthcheckRow {
  id: string;
  feature: string;
  component: string;
  display_name: string;
  state: HealthcheckState;
  metadata_json?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Healthcheck extends Omit<HealthcheckRow, "metadata_json"> {
  metadata: Record<string, unknown>;
}

export interface HealthcheckAccessOptions {
  who?: string;
}

export interface FeatureManifest {
  name?: string;
  displayName?: string;
  packageName?: string;
  version?: string;
  healthcheck?: (
    env: HealthcheckEnvironment,
    options: HealthcheckAccessOptions,
  ) => HealthcheckInput | readonly HealthcheckInput[] | Promise<HealthcheckInput | readonly HealthcheckInput[]>;
  healthchecks?: readonly HealthcheckInput[];
  circuitBreakers?: readonly import("../circuits/model.js").CircuitBreakerInput[];
  [key: string]: unknown;
}

export interface HealthcheckEnvironment {
  DB?: D1Database;
  features?: readonly FeatureManifest[];
  [key: string]: unknown;
}

export interface NormalizedFeatureManifest {
  feature: string;
  display_name: string;
  package_name: string | null;
  version: string | null;
}
