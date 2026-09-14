import { auditLog, createD1 } from "./core.js";
import { ensureUser, listUserTenants } from "./authorization.js";

export const DATA_SCOPES = ["user", "tenant", "system"];
export const DATA_OPERATIONS = ["read", "create", "update", "delete"];

export class DataScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataScopeError";
  }
}

export function normalizeDataResources(resources = []) {
  const names = new Set();
  return resources.map((resource) => {
    if (!resource || !/^[a-z][a-z0-9_-]*$/.test(String(resource.name || ""))) throw new TypeError("Data resources require a safe name");
    if (!/^[a-z][a-z0-9_]*$/.test(String(resource.table || ""))) throw new TypeError(`Data resource ${resource.name} requires a safe table name`);
    const name = String(resource.name);
    if (names.has(name)) throw new TypeError(`Duplicate data resource: ${name}`);
    names.add(name);
    const scope = String(resource.scope || "").toLowerCase();
    if (!DATA_SCOPES.includes(scope)) throw new TypeError(`Data resource ${resource.name} requires scope user, tenant, or system`);
    const columns = [...new Set((resource.columns || []).map(String))];
    if (!columns.length || columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) throw new TypeError(`Data resource ${resource.name} requires safe columns`);
    const idColumn = String(resource.idColumn || "id");
    if (!columns.includes(idColumn)) throw new TypeError(`Data resource ${resource.name} must include ${idColumn}`);
    const ownerColumn = resource.ownerColumn ? String(resource.ownerColumn) : "user_id";
    const tenantColumn = resource.tenantColumn ? String(resource.tenantColumn) : "tenant_id";
    if (scope === "user" && !columns.includes(ownerColumn)) throw new TypeError(`User resource ${resource.name} must include ${ownerColumn}`);
    if (scope === "tenant" && !columns.includes(tenantColumn)) throw new TypeError(`Tenant resource ${resource.name} must include ${tenantColumn}`);
    const filterableColumns = [...new Set((resource.filterableColumns || columns).map(String))];
    const orderableColumns = [...new Set((resource.orderableColumns || columns).map(String))];
    for (const column of [...filterableColumns, ...orderableColumns]) if (!columns.includes(column)) throw new TypeError(`Data resource ${resource.name} references an unselected column`);
    const writableColumns = [...new Set((resource.writableColumns || []).map(String))].filter((column) => column !== ownerColumn && column !== tenantColumn);
    if (writableColumns.some((column) => !columns.includes(column))) throw new TypeError(`Data resource ${resource.name} references an unwritable column`);
    const operations = [...new Set((resource.operations || ["read", ...(writableColumns.length ? ["create", "update", "delete"] : [])]).map((operation) => String(operation).toLowerCase()))];
    if (!operations.length || operations.some((operation) => !DATA_OPERATIONS.includes(operation)) || !operations.includes("read")) throw new TypeError(`Data resource ${name} has invalid operations`);
    return { ...resource, name, table: String(resource.table), scope, columns, idColumn, ownerColumn, tenantColumn, filterableColumns, orderableColumns, writableColumns, operations };
  });
}

export function createDataReader(env, { resources = [], context } = {}) {
  const registry = new Map(normalizeDataResources(resources).map((resource) => [resource.name, resource]));
  const getContext = typeof context === "function" ? context : async () => context || {};
  const scope = (requestedScope) => ({
    list: (name, options) => readList(name, requestedScope, options),
    page: (name, options) => readPage(name, requestedScope, options),
    get: async (name, id) => (await readList(name, requestedScope, { where: { [registry.get(name)?.idColumn || "id"]: id }, limit: 1 }))[0] || null,
    insert: (name, values) => writeInsert(name, requestedScope, values),
    update: (name, id, changes) => writeUpdate(name, requestedScope, id, changes),
    delete: (name, id) => writeDelete(name, requestedScope, id),
  });

  async function readList(name, requestedScope, { where = {}, limit = 100, orderBy } = {}) {
    return (await readPage(name, requestedScope, { where, limit, orderBy })).rows;
  }

  async function readPage(name, requestedScope, { where = {}, limit = 100, orderBy, cursor } = {}) {
    const resource = getResource(name);
    const actor = await getContext();
    if (!isAllowed(resource, requestedScope, actor, "read")) return { rows: [], nextCursor: null };
    const predicates = [];
    const bindings = [];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    addFilters(resource, where, predicates, bindings);
    if (cursor !== undefined && cursor !== null) { predicates.push(`${quote(resource.idColumn)}>?`); bindings.push(cursor); }
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    let sql = `SELECT ${resource.columns.map(quote).join(",")} FROM ${quote(resource.table)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} LIMIT ${safeLimit}`;
    if (orderBy) {
      const [column, direction = "ASC"] = String(orderBy).split(/\s+/, 2);
      if (!resource.orderableColumns.includes(column)) throw new TypeError(`Column ${column} cannot order ${resource.name}`);
      sql = sql.replace(` LIMIT ${safeLimit}`, ` ORDER BY ${quote(column)} ${direction.toUpperCase() === "DESC" ? "DESC" : "ASC"} LIMIT ${safeLimit}`);
    }
    const result = await createD1(env, { who: actorLabel(actor) }).prepare(sql).bind(...bindings).all();
    const rows = result.results || [];
    return { rows, nextCursor: rows.length === safeLimit ? rows[rows.length - 1][resource.idColumn] : null };
  }

  async function writeInsert(name, requestedScope, values = {}) {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "create");
    const data = cleanWritableValues(resource, values, { includeId: true, includeOwnership: requestedScope === "system" });
    addOwnedValue(resource, requestedScope, actor, data);
    const columns = Object.keys(data);
    if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);
    await createD1(env, { who: actorLabel(actor) }).prepare(`INSERT INTO ${quote(resource.table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...columns.map((column) => data[column])).run();
    return data[resource.idColumn] === undefined ? data : (await readList(name, requestedScope, { where: { [resource.idColumn]: data[resource.idColumn] }, limit: 1 }))[0] || data;
  }

  async function writeUpdate(name, requestedScope, id, changes = {}) {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "update");
    const data = cleanWritableValues(resource, changes, { includeOwnership: requestedScope === "system" });
    const columns = Object.keys(data);
    if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);
    const predicates = [`${quote(resource.idColumn)}=?`];
    const bindings = [id];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    await createD1(env, { who: actorLabel(actor) }).prepare(`UPDATE ${quote(resource.table)} SET ${columns.map((column) => `${quote(column)}=?`).join(",")} WHERE ${predicates.join(" AND ")}`).bind(...columns.map((column) => data[column]), ...bindings).run();
    return (await readList(name, requestedScope, { where: { [resource.idColumn]: id }, limit: 1 }))[0] || null;
  }

  async function writeDelete(name, requestedScope, id) {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "delete");
    const predicates = [`${quote(resource.idColumn)}=?`];
    const bindings = [id];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    return createD1(env, { who: actorLabel(actor) }).prepare(`DELETE FROM ${quote(resource.table)} WHERE ${predicates.join(" AND ")}`).bind(...bindings).run();
  }

  function getResource(name) {
    const resource = registry.get(String(name));
    if (!resource) throw new TypeError(`Unknown data resource: ${name}`);
    return resource;
  }

  return { user: scope("user"), tenant: scope("tenant"), system: scope("system"), resources: [...registry.values()] };
}

export async function requestDataContext(env, { state = {}, request } = {}) {
  const authUser = state.authUser || (state.user ? await ensureUser(env, state.user, { who: `user:${state.user.sub || "unknown"}` }) : null);
  const system = Boolean(state.user?.auth_strategy === "http_basic" || (authUser && authUser.is_admin));
  if (!authUser) return { userId: null, tenantId: null, system: false };
  const tenants = await listUserTenants(env, authUser.id, { who: `user:${authUser.id}` });
  const requestedTenant = state.tenantId || request?.headers?.get("X-Tenant-ID") || null;
  const tenant = requestedTenant ? tenants.find((item) => item.id === requestedTenant) : tenants.length === 1 ? tenants[0] : null;
  return { userId: authUser.id, tenantId: tenant?.id || null, system, tenants };
}

function isAllowed(resource, requestedScope, actor, operation) {
  const allowed = requestedScope === "system" ? Boolean(actor.system) : requestedScope === resource.scope && (requestedScope === "user" ? Boolean(actor.userId) : Boolean(actor.userId && actor.tenantId));
  if (!allowed || !resource.operations.includes(operation)) {
    auditLog({ who: actorLabel(actor), operation: "deny", resource: `data:${resource.name}:${requestedScope}:${operation}` });
    return false;
  }
  return true;
}

function assertWritable(resource, requestedScope, actor, operation) {
  if (!isAllowed(resource, requestedScope, actor, operation)) throw new DataScopeError(`Data scope ${requestedScope} cannot ${operation} resource ${resource.name}`);
}

function addScopePredicate(resource, requestedScope, actor, predicates, bindings) {
  if (requestedScope === "user") { predicates.push(`${quote(resource.ownerColumn)}=?`); bindings.push(actor.userId); }
  if (requestedScope === "tenant") { predicates.push(`${quote(resource.tenantColumn)}=?`); bindings.push(actor.tenantId); }
}

function addFilters(resource, where, predicates, bindings) {
  for (const [column, value] of Object.entries(where || {})) {
    if (!resource.filterableColumns.includes(column)) throw new TypeError(`Column ${column} cannot filter ${resource.name}`);
    if (value === null) predicates.push(`${quote(column)} IS NULL`);
    else { predicates.push(`${quote(column)}=?`); bindings.push(value); }
  }
}

function cleanWritableValues(resource, values, { includeId = false, includeOwnership = false } = {}) {
  return Object.fromEntries(Object.entries(values || {}).filter(([column]) => (resource.writableColumns.includes(column) || (includeOwnership && [resource.ownerColumn, resource.tenantColumn].includes(column))) && (includeId || column !== resource.idColumn)));
}

function addOwnedValue(resource, requestedScope, actor, data) {
  if (requestedScope === "user") data[resource.ownerColumn] = actor.userId;
  if (requestedScope === "tenant") data[resource.tenantColumn] = actor.tenantId;
}

function actorLabel(actor) { return actor.system ? "system:data" : `user:${actor.userId || "unknown"}`; }
function quote(identifier) { return `"${identifier}"`; }
