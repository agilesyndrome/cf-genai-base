/**
 * Public package surface. Runtime composition and platform services live in
 * focused modules under ./runtime, ./core, ./auth, ./api, ./admin, and ./ui.
 */
export { createWorker } from "./runtime/worker.js";
export type * from "./runtime/model.js";
export { ensureFeatureManifests } from "./runtime/features.js";
export { assertBoot, validateBoot, methodNotAllowed, healthResponse } from "./runtime/health.js";
export * from "./app.js";
export * from "./domain/index.js";
export { BUILT_IN_FEATURES, defineFeature, resolveFeatures, createLLMFeature, createMessagingFeature } from "./features/index.js";
export type {
  BuiltInFeatureName,
  BuiltInFeatureOptions,
  FeatureRegistration,
  FeatureRequest,
  LLMFeatureOptions,
  MessagingFeatureOptions,
} from "./features/index.js";
export * from "./core/index.js";
export * from "./data/index.js";
export * from "./auth/index.js";
export { secureResponse } from "./core/security/index.js";
