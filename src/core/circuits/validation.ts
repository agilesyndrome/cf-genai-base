import { CIRCUIT_BREAKER_STATES, HEALTHCHECK_MODES } from "../constants.js";
import type {
  CircuitBreakerInput,
  NormalizedCircuitBreaker,
} from "./model.js";

export function normalizeCircuitBreaker(
  input: CircuitBreakerInput = {},
): NormalizedCircuitBreaker {
  const state = String(input.state || "off").toLowerCase();
  const healthcheckMode = String(input.healthcheckMode || "any").toLowerCase();

  if (!CIRCUIT_BREAKER_STATES.includes(state as never)) {
    throw new Error("Circuit breaker state must be off, tripped, or on");
  }
  if (!HEALTHCHECK_MODES.includes(healthcheckMode as never)) {
    throw new Error("Circuit breaker healthcheckMode must be any or all");
  }
  if (!input.feature || !input.name || !input.displayName) {
    throw new Error("Circuit breakers require feature, name, and displayName");
  }

  return {
    feature: String(input.feature),
    name: String(input.name),
    displayName: String(input.displayName),
    state: state as NormalizedCircuitBreaker["state"],
    healthcheckMode: healthcheckMode as NormalizedCircuitBreaker["healthcheckMode"],
    allowSelfHealing: Boolean(input.allowSelfHealing),
    healthchecks: Array.isArray(input.healthchecks) ? input.healthchecks.map(String) : [],
    dependsOnCircuitBreakers: Array.isArray(input.dependsOnCircuitBreakers)
      ? input.dependsOnCircuitBreakers.map(String)
      : [],
    metadata: input.metadata || {},
  };
}

export function circuitBreakerState(value: unknown): NormalizedCircuitBreaker["state"] {
  const state = String(value).toLowerCase();
  if (!CIRCUIT_BREAKER_STATES.includes(state as never)) {
    throw new Error("Circuit breaker state must be off, tripped, or on");
  }
  return state as NormalizedCircuitBreaker["state"];
}

