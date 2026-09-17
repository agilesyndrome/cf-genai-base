import type {
  DomainAuth,
  DomainRoute,
  DomainRouteInput,
  DomainView,
} from "./model.js";
import type { DataResourceInput } from "../data/model.js";
import type { RepositoryDefinitionInput } from "../repository/model.js";

export interface AppDomainOptions {
  name: string;
  basePath: string;
  auth?: DomainAuth;
  scopes?: string | readonly string[];
  csrf?: boolean;
  dataResources?: readonly DataResourceInput[];
  repositories?: readonly RepositoryDefinitionInput[];
}

/**
 * A domain is the reusable unit of application composition: model type, API policy,
 * routes, and named views travel together. It has no admin assumption, so packages
 * such as cookbook can publish public, signed-in, scoped, or administrator domains.
 */
export abstract class AppDomain<Model = unknown, Env = unknown, State = unknown> {
  readonly name: string;
  readonly basePath: string;
  readonly dataResources: readonly DataResourceInput[];
  readonly repositories: readonly RepositoryDefinitionInput[];
  declare readonly Model: Model;
  readonly #defaults: {
    auth: DomainAuth;
    scopes: readonly string[];
    csrf: boolean;
  };
  readonly #routes: DomainRoute<Env, State>[] = [];
  readonly #views = new Map<string, DomainView<never, unknown>>();

  protected constructor(options: AppDomainOptions) {
    if (!/^[a-z][a-z0-9.-]*$/.test(options.name)) {
      throw new TypeError("Domain names must be lowercase dot-separated identifiers.");
    }
    if (!options.basePath.startsWith("/")) {
      throw new TypeError("Domain basePath must be absolute.");
    }
    this.name = options.name;
    this.basePath = options.basePath === "/" ? "/" : options.basePath.replace(/\/$/, "");
    this.dataResources = [...(options.dataResources ?? [])];
    this.repositories = [...(options.repositories ?? [])];
    this.#defaults = {
      auth: options.auth ?? "public",
      scopes: asList(options.scopes),
      csrf: options.csrf ?? false,
    };
  }

  protected route(input: DomainRouteInput<Env, State>): void {
    const suffix = input.path ?? "";
    const method = typeof input.method === "string"
      ? upper(input.method)
      : input.method.map(upper);
    const path = input.absolutePath ?? joinPath(this.basePath, suffix);
    const { absolutePath: _absolutePath, ...route } = input;
    this.#routes.push({
      ...route,
      method,
      path,
      auth: input.auth ?? this.#defaults.auth,
      scopes: input.scopes === undefined ? this.#defaults.scopes : asList(input.scopes),
      scopeMode: input.scopeMode ?? "all",
      csrf: input.csrf ?? this.#defaults.csrf,
      domain: this.name,
    });
  }

  protected view<Props, Result>(name: string, renderer: DomainView<Props, Result>): void {
    if (this.#views.has(name)) throw new TypeError(`Duplicate ${this.name} view: ${name}`);
    this.#views.set(name, renderer);
  }

  get routes(): readonly DomainRoute<Env, State>[] {
    return this.#routes;
  }

  getView(name: string): DomainView<never, unknown> {
    const view = this.#views.get(name);
    if (!view) throw new TypeError(`Unknown ${this.name} view: ${name}`);
    return view;
  }

  /** Optional idempotent boot hook for manifests or other domain-owned setup. */
  initialize(_env: Env, _context: { ctx: ExecutionContext }): void | Promise<void> {}
}

function asList(value?: string | readonly string[]): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : [...value];
}

function upper(value: string): string {
  return String(value).toUpperCase();
}
function joinPath(basePath: string, suffix: string): string {
  if (!suffix) return basePath;
  return `${basePath === "/" ? "" : basePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
