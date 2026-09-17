import { auditLog } from "./core/events/index.js";
import type { DataRow, DataScopeReader } from "./data/model.js";
import type {
  Repository,
  RepositoryDefinition,
  RepositoryDefinitionInput,
  RepositoryEnvironment,
  RepositoryHook,
} from "./repository/model.js";

export type * from "./repository/model.js";

export class RepositoryError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "RepositoryError";
    this.status = status;
  }
}

export function defineRepository(
  {
    name,
    resource,
    scope = "tenant",
    relations = {},
    hooks = {},
    resourceDefinition = null,
  }: RepositoryDefinitionInput = {},
): RepositoryDefinition {
  if (!/^[a-z][a-z0-9_-]*$/.test(String(name || ""))) {
    throw new TypeError("Repositories require a safe name");
  }
  if (!resource) throw new TypeError(`Repository ${name} requires a data resource`);
  return {
    name: String(name),
    resource: String(resource),
    scope,
    relations: { ...relations },
    hooks: { ...hooks },
    resourceDefinition,
  };
}

export function createRepositories(
  env: RepositoryEnvironment,
  definitions: readonly RepositoryDefinitionInput[] = [],
  { context }: { context?: unknown } = {},
): Record<string, Repository> {
  const specs = new Map(
    definitions.map((definition) => {
      const spec = defineRepository(definition);
      return [spec.name, spec];
    }),
  );
  const repositories = new Map<string, Repository>();

  const get = (name: string): Repository => {
    const result = repositories.get(String(name));
    if (!result) throw new RepositoryError(`Unknown repository: ${name}`, 500);
    return result;
  };

  // Build every repository before exposing any of them so relations can point forward.
  for (const spec of specs.values()) repositories.set(spec.name, createRepository(spec));
  return Object.fromEntries(repositories);

  function createRepository(spec: RepositoryDefinition): Repository {
    const reader = (): DataScopeReader => {
      const data = env?.data;
      const scopedReader = data?.[spec.scope];
      if (!scopedReader) {
        throw new RepositoryError(`Data scope ${spec.scope} is unavailable`, 500);
      }
      return scopedReader;
    };

    const invoke = async <Input, Output = Input>(
      hook: RepositoryHook<Input, Output> | undefined,
      value: Input,
    ): Promise<Input | Output> => {
      return typeof hook === "function"
        ? hook(value, { env, context, repository: api })
        : value;
    };

    const api: Repository = {
      name: spec.name,
      resource: spec.resource,
      async list(options) {
        return invoke(spec.hooks.list, await reader().list(spec.resource, options));
      },
      async page(options) {
        return invoke(spec.hooks.page, await reader().page(spec.resource, options));
      },
      async count(options) {
        return reader().count(spec.resource, options);
      },
      async find(id) {
        return invoke(spec.hooks.find, await reader().get(spec.resource, id));
      },
      async findOne(where, options = {}) {
        const rows = await reader().list(spec.resource, { ...options, where, limit: 1 });
        return invoke(spec.hooks.findOne, rows[0] || null);
      },
      async insert(values) {
        const result = await reader().insert(spec.resource, await invoke(spec.hooks.beforeInsert, values));
        auditLog({ who: "repository", operation: "create", resource: spec.name });
        return invoke(spec.hooks.afterInsert, result);
      },
      async update(id, changes) {
        const result = await reader().update(spec.resource, id, await invoke(spec.hooks.beforeUpdate, changes));
        auditLog({ who: "repository", operation: "update", resource: spec.name });
        return invoke(spec.hooks.afterUpdate, result);
      },
      async updateWhere(where, changes) {
        return reader().updateWhere(
          spec.resource,
          where,
          await invoke(spec.hooks.beforeUpdate, changes),
        );
      },
      async delete(id) {
        const result = await reader().delete(spec.resource, id);
        auditLog({ who: "repository", operation: "delete", resource: spec.name });
        return result;
      },
      async deleteWhere(where) {
        return reader().deleteWhere(spec.resource, where);
      },
      async link(relation, record) {
        const relationSpec = spec.relations[relation];
        if (!relationSpec) {
          throw new RepositoryError(`Unknown relation ${spec.name}.${relation}`, 500);
        }
        const target = get(relationSpec.repository);
        const localKey = relationSpec.localKey || "id";
        const foreignKey = relationSpec.foreignKey || `${spec.name}_id`;
        const value = record?.[localKey];
        if (value === undefined || value === null) {
          return relationSpec.many === false ? null : [];
        }
        return relationSpec.many === false
          ? target.findOne({ [foreignKey]: value })
          : target.list({
            where: { [foreignKey]: value, ...(relationSpec.where || {}) },
            ...(relationSpec.options || {}),
          });
      },
    };
    return api;
  }
}
