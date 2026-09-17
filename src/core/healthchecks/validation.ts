import { HEALTHCHECK_STATES } from "../constants.js";
import type {
  FeatureManifest,
  HealthcheckInput,
  NormalizedFeatureManifest,
  NormalizedHealthcheck,
} from "./model.js";

export function normalizeHealthcheck(input: HealthcheckInput = {}): NormalizedHealthcheck {
  const state = String(input.state || "yellow").toLowerCase();
  if (!HEALTHCHECK_STATES.includes(state as never)) {
    throw new Error("Healthcheck state must be red, yellow, or green");
  }
  if (!input.feature || !input.component || !input.displayName) {
    throw new Error("Healthchecks require feature, component, and displayName");
  }

  return {
    feature: String(input.feature),
    component: String(input.component),
    displayName: String(input.displayName),
    state: state as NormalizedHealthcheck["state"],
    metadata: input.metadata || {},
  };
}

export function healthcheckState(value: unknown): NormalizedHealthcheck["state"] {
  const state = String(value).toLowerCase();
  if (!HEALTHCHECK_STATES.includes(state as never)) {
    throw new Error("Healthcheck state must be red, yellow, or green");
  }
  return state as NormalizedHealthcheck["state"];
}

export function normalizeFeatureManifest(
  feature: FeatureManifest = {},
): NormalizedFeatureManifest {
  const source = feature && typeof feature === "object" ? feature : {};
  const removedFields = [
    "id",
    "manifest",
    "display_name",
    "package",
    "package_name",
    "packageVersion",
    "package_version",
  ];
  for (const removed of removedFields) {
    if (Object.hasOwn(source, removed)) {
      throw new TypeError(`Feature manifest ${removed} is not supported`);
    }
  }
  if (!source.name) throw new TypeError("Feature manifests require a name");

  const name = String(source.name);
  return {
    feature: name,
    display_name: String(source.displayName || name),
    package_name: source.packageName ? String(source.packageName) : null,
    version: source.version ? String(source.version) : null,
  };
}

