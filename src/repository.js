import { auditLog } from "./core.js";

export class RepositoryError extends Error {
  constructor(message, status = 500) { super(message); this.name = "RepositoryError"; this.status = status; }
}

export function defineRepository({ name, resource, scope = "tenant", relations = {}, hooks = {}, resourceDefinition = null } = {}) {
  if (!/^[a-z][a-z0-9_-]*$/.test(String(name || ""))) throw new TypeError("Repositories require a safe name");
  if (!resource) throw new TypeError(`Repository ${name} requires a data resource`);
  return { name: String(name), resource: String(resource), scope, relations: { ...relations }, hooks: { ...hooks }, resourceDefinition };
}

export function createRepositories(env, definitions = [], { context } = {}) {
  const specs = new Map(definitions.map((definition) => {
    const spec = defineRepository(definition);
    return [spec.name, spec];
  }));
  const repositories = new Map();
  const get = (name) => {
    const repository = repositories.get(String(name));
    if (!repository) throw new RepositoryError(`Unknown repository: ${name}`, 500);
    return repository;
  };
  for (const spec of specs.values()) repositories.set(spec.name, repository(spec));
  return Object.fromEntries([...repositories].map(([name, value]) => [name, value]));

  function repository(spec) {
    const reader = () => {
      const data = env?.data;
      if (!data?.[spec.scope]) throw new RepositoryError(`Data scope ${spec.scope} is unavailable`, 500);
      return data[spec.scope];
    };
    const invoke = async (operation, value) => {
      const hook = spec.hooks[operation];
      return typeof hook === "function" ? hook(value, { env, context, repository: api }) : value;
    };
    const api = {
      name: spec.name,
      resource: spec.resource,
      async list(options) { return invoke("list", await reader().list(spec.resource, options)); },
      async page(options) { return invoke("page", await reader().page(spec.resource, options)); },
      async count(options) { return reader().count(spec.resource, options); },
      async find(id) { return invoke("find", await reader().get(spec.resource, id)); },
      async findOne(where, options = {}) { return invoke("findOne", (await reader().list(spec.resource, { ...options, where, limit: 1 }))[0] || null); },
      async insert(values) { const result = await reader().insert(spec.resource, await invoke("beforeInsert", values)); auditLog({ who: "repository", operation: "create", resource: spec.name }); return invoke("afterInsert", result); },
      async update(id, changes) { const result = await reader().update(spec.resource, id, await invoke("beforeUpdate", changes)); auditLog({ who: "repository", operation: "update", resource: spec.name }); return invoke("afterUpdate", result); },
      async updateWhere(where, changes) { return reader().updateWhere(spec.resource, where, await invoke("beforeUpdate", changes)); },
      async delete(id) { const result = await reader().delete(spec.resource, id); auditLog({ who: "repository", operation: "delete", resource: spec.name }); return result; },
      async deleteWhere(where) { return reader().deleteWhere(spec.resource, where); },
      async link(relation, record) {
        const relationSpec = spec.relations[relation];
        if (!relationSpec) throw new RepositoryError(`Unknown relation ${spec.name}.${relation}`, 500);
        const target = get(relationSpec.repository);
        const localKey = relationSpec.localKey || "id";
        const foreignKey = relationSpec.foreignKey || `${spec.name}_id`;
        const value = record?.[localKey];
        if (value === undefined || value === null) return relationSpec.many === false ? null : [];
        return relationSpec.many === false ? target.findOne({ [foreignKey]: value }) : target.list({ where: { [foreignKey]: value, ...(relationSpec.where || {}) }, ...(relationSpec.options || {}) });
      },
    };
    return api;
  }
}
