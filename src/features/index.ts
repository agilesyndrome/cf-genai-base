import { createLLMFeature } from "./llm/index.js";
import { createMessagingFeature } from "./messaging/index.js";
import type { LLMFeatureOptions } from "./llm/index.js";
import type { MessagingFeatureOptions } from "./messaging/index.js";
import type { RuntimeFeature } from "../runtime/model.js";

const factories = Object.freeze({
  llm: createLLMFeature,
  messaging: createMessagingFeature,
});

export type BuiltInFeatureName = keyof typeof factories;

export interface BuiltInFeatureOptions {
  llm: LLMFeatureOptions;
  messaging: MessagingFeatureOptions;
}

export interface FeatureRequest<Name extends BuiltInFeatureName = BuiltInFeatureName> {
  feature: Name;
  options?: BuiltInFeatureOptions[Name];
}

export type FeatureRegistration = BuiltInFeatureName | FeatureRequest | RuntimeFeature;

export const BUILT_IN_FEATURES = Object.freeze(Object.keys(factories) as BuiltInFeatureName[]);

export function defineFeature<Name extends BuiltInFeatureName>(
  name: Name,
  options?: BuiltInFeatureOptions[Name],
): Readonly<FeatureRequest<Name>> {
  const normalizedName = String(name || "").trim();
  if (!Object.hasOwn(factories, normalizedName)) {
    throw new TypeError(`Unknown built-in feature: ${normalizedName || "(empty)"}`);
  }
  const resolvedOptions = options ?? {};
  if (typeof resolvedOptions !== "object" || Array.isArray(resolvedOptions)) {
    throw new TypeError(`Feature options for ${normalizedName} must be an object`);
  }
  return Object.freeze({
    feature: normalizedName as Name,
    options: { ...resolvedOptions } as BuiltInFeatureOptions[Name],
  });
}

export function resolveFeatures(requests: readonly unknown[] = []): RuntimeFeature[] {
  if (!Array.isArray(requests)) throw new TypeError("features must be an array");
  const resolved: RuntimeFeature[] = [];
  const names = new Set<string>();

  for (const request of requests) {
    const feature = resolveFeature(request);
    const name = String(feature?.name || "").trim();
    if (!name) throw new TypeError("Features require a name");
    if (names.has(name)) throw new TypeError(`Duplicate feature: ${name}`);
    names.add(name);
    resolved.push(feature);
  }
  return resolved;
}

function resolveFeature(request: unknown): RuntimeFeature {
  if (typeof request === "string") return createBuiltInFeature(request);
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Feature requests must be names or feature objects");
  }
  if ("feature" in request && typeof request.feature === "string") {
    const options = "options" in request && request.options && typeof request.options === "object"
      ? request.options as Record<string, unknown>
      : {};
    return createBuiltInFeature(request.feature, options);
  }
  return request as RuntimeFeature;
}

function createBuiltInFeature(
  name: string,
  options: Record<string, unknown> = {},
): RuntimeFeature {
  const normalizedName = String(name || "").trim() as BuiltInFeatureName;
  const factory = factories[normalizedName];
  if (!factory) throw new TypeError(`Unknown built-in feature: ${normalizedName || "(empty)"}`);
  return factory({ ...options, name: normalizedName }) as RuntimeFeature;
}

export { createLLMFeature, createMessagingFeature };
export type { LLMFeatureOptions, MessagingFeatureOptions };
