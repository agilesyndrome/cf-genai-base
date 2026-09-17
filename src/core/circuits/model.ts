import type { CircuitBreakerState, HealthcheckMode } from "../constants.js";

export interface CircuitBreakerInput {
  id?: string;
  feature?: string;
  name?: string;
  displayName?: string;
  state?: string;
  healthcheckMode?: string;
  allowSelfHealing?: boolean;
  healthchecks?: readonly unknown[];
  dependsOnCircuitBreakers?: readonly unknown[];
  metadata?: Record<string, unknown>;
}

export interface NormalizedCircuitBreaker {
  feature: string;
  name: string;
  displayName: string;
  state: CircuitBreakerState;
  healthcheckMode: HealthcheckMode;
  allowSelfHealing: boolean;
  healthchecks: string[];
  dependsOnCircuitBreakers: string[];
  metadata: Record<string, unknown>;
}

export interface CircuitBreakerRow {
  id: string;
  feature: string;
  name: string;
  display_name: string;
  state: CircuitBreakerState;
  healthcheck_mode: HealthcheckMode;
  allow_self_healing: number | boolean;
  metadata_json?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CircuitBreaker extends Omit<CircuitBreakerRow, "allow_self_healing" | "metadata_json"> {
  allow_self_healing: boolean;
  metadata: Record<string, unknown>;
  healthchecks: string[];
  depends_on_circuit_breakers: string[];
}

export interface CircuitAccessOptions {
  who?: string;
}

export interface CircuitUpdateOptions extends CircuitAccessOptions {
  automated?: boolean;
}
