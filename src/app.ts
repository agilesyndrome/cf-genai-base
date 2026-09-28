import type { AppDomain } from "./domain/index.js";
import type { AnyRecordDefinition } from "./data/records.js";

export type AnyAppDomain = AppDomain<unknown, unknown, unknown>;

export interface AppDefinitionInput<
  Feature = unknown,
  Domain extends AnyAppDomain = AnyAppDomain,
> {
  name?: string;
  features?: readonly Feature[];
  domains?: readonly Domain[];
  readOnlyDomains?: readonly Domain[];
  records?: readonly AnyRecordDefinition[];
}

export interface AppDefinition<
  Feature = unknown,
  Domain extends AnyAppDomain = AnyAppDomain,
> {
  readonly name: string;
  readonly features: readonly Feature[];
  readonly domains: readonly Domain[];
  readonly readOnlyDomains: readonly Domain[];
  readonly records: readonly AnyRecordDefinition[];
}

/** Register all application-owned capabilities in one deployable manifest. */
export function defineApp<
  const Feature = unknown,
  const Domain extends AnyAppDomain = AnyAppDomain,
>(input: AppDefinitionInput<Feature, Domain> = {}): Readonly<AppDefinition<Feature, Domain>> {
  if ("repositories" in input) {
    throw new TypeError("Repositories belong to an AppDomain, not directly to an app");
  }
  const { name = "worker", features = [], domains = [], readOnlyDomains = [], records = [] } = input;
  if (!/^[a-z][a-z0-9-]*$/.test(String(name || ""))) throw new TypeError("Apps require a safe name");
  const names = domains.map((domain) => domain.name);
  const readOnlyNames = readOnlyDomains.map((domain) => domain.name);
  if (new Set([...names, ...readOnlyNames]).size !== names.length + readOnlyNames.length) {
    throw new TypeError("Apps cannot register a domain twice or in both domain lists");
  }
  return Object.freeze({
    name: String(name),
    features: Object.freeze([...features]),
    domains: Object.freeze([...domains]),
    readOnlyDomains: Object.freeze([...readOnlyDomains]),
    records: Object.freeze([...records]),
  });
}
