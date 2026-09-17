import type { AppDomain } from "./domain/index.js";

export type AnyAppDomain = AppDomain<unknown, unknown, unknown>;

export interface AppDefinitionInput<
  Feature = unknown,
  Domain extends AnyAppDomain = AnyAppDomain,
> {
  name: string;
  ui?: boolean;
  api?: boolean;
  admin?: boolean;
  features?: readonly Feature[];
  domains?: readonly Domain[];
}

export interface AppDefinition<
  Feature = unknown,
  Domain extends AnyAppDomain = AnyAppDomain,
> {
  readonly name: string;
  readonly ui: boolean;
  readonly api: boolean;
  readonly admin: boolean;
  readonly features: readonly Feature[];
  readonly domains: readonly Domain[];
}

/** Register all application-owned capabilities in one deployable manifest. */
export function defineApp<
  const Feature = unknown,
  const Domain extends AnyAppDomain = AnyAppDomain,
>(input: AppDefinitionInput<Feature, Domain>): Readonly<AppDefinition<Feature, Domain>> {
  if ("repositories" in input) {
    throw new TypeError("Repositories belong to an AppDomain, not directly to an app");
  }
  const { name, ui = true, api = true, admin = true, features = [], domains = [] } = input;
  if (!/^[a-z][a-z0-9-]*$/.test(String(name || ""))) throw new TypeError("Apps require a safe name");
  if (!ui && !api) throw new TypeError("An app must expose ui or api");
  const names = domains.map((domain) => domain.name);
  if (new Set(names).size !== names.length) throw new TypeError("Apps cannot register a domain twice");
  return Object.freeze({
    name: String(name),
    ui: Boolean(ui),
    api: Boolean(api),
    admin: Boolean(admin),
    features: Object.freeze([...features]),
    domains: Object.freeze([...domains]),
  });
}
