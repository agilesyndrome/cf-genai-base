export const HEALTHCHECK_STATES = ["red", "yellow", "green"] as const;
export const CIRCUIT_BREAKER_STATES = ["off", "tripped", "on"] as const;
export const HEALTHCHECK_MODES = ["any", "all"] as const;
export const BASE_PACKAGE_NAME = "@agilesyndrome/cf-genai-base";
export const BASE_VERSION = "5.0.3";

export type HealthcheckState = (typeof HEALTHCHECK_STATES)[number];
export type CircuitBreakerState = (typeof CIRCUIT_BREAKER_STATES)[number];
export type HealthcheckMode = (typeof HEALTHCHECK_MODES)[number];
