import { auditLog, createD1 } from "../core/index.js";
import { DataScopeError, normalizeDataResources } from "./resources.js";

export function createDataReader(env, { resources = [], context } = {}) {
  const registry = new Map(normalizeDataResources(resources).map((resource) => [resource.name, resource]));
  const getContext = typeof context === "function" ? context : async () => context || {};
  const scope = (requestedScope) => ({
    list: (name, options) => readList(name, requestedScope, options), page: (name, options) => readPage(name, requestedScope, options), count: (name, options) => readCount(name, requestedScope, options),
    get: async (name, id) => (await readList(name, requestedScope, { where: { [registry.get(name)?.idColumn || "id"]: id }, limit: 1 }))[0] || null,
    insert: (name, values) => writeInsert(name, requestedScope, values), update: (name, id, changes) => writeUpdate(name, requestedScope, id, changes), updateWhere: (name, where, changes) => writeUpdateWhere(name, requestedScope, where, changes), delete: (name, id) => writeDelete(name, requestedScope, id), deleteWhere: (name, where) => writeDeleteWhere(name, requestedScope, where),
  });

  async function readList(name, requestedScope, { where = {}, limit = 100, orderBy, offset = 0 } = {}) { return (await readPage(name, requestedScope, { where, limit, orderBy, offset })).rows; }

  async function readPage(name, requestedScope, { where = {}, limit = 100, orderBy, cursor, offset = 0 } = {}) {
    const resource = getResource(name); const actor = await getContext(); if (!isAllowed(resource, requestedScope, actor, "read")) return { rows: [], nextCursor: null };
    const predicates = []; const bindings = []; addScopePredicate(resource, requestedScope, actor, predicates, bindings); addFilters(resource, where, predicates, bindings);
    if (cursor !== undefined && cursor !== null) { predicates.push(`${quote(resource.idColumn)}>?`); bindings.push(cursor); }
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000); const safeOffset = Math.max(Number(offset) || 0, 0);
    let sql = `SELECT ${resource.readableColumns.map(quote).join(",")} FROM ${quote(resource.table)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    if (orderBy) { const [column, direction = "ASC"] = String(orderBy).split(/\s+/, 2); if (!resource.orderableColumns.includes(column)) throw new TypeError(`Column ${column} cannot order ${resource.name}`); sql = sql.replace(` LIMIT ${safeLimit}`, ` ORDER BY ${quote(column)} ${direction.toUpperCase() === "DESC" ? "DESC" : "ASC"} LIMIT ${safeLimit}`); }
    const result = await createD1(env, { who: actorLabel(actor) }).prepare(sql).bind(...bindings).all(); const rows = result.results || [];
    return { rows, nextCursor: rows.length === safeLimit ? rows[rows.length - 1][resource.idColumn] : null };
  }

  async function readCount(name, requestedScope, { where = {} } = {}) {
    const resource = getResource(name); const actor = await getContext(); if (!isAllowed(resource, requestedScope, actor, "read")) return 0;
    const predicates = []; const bindings = []; addScopePredicate(resource, requestedScope, actor, predicates, bindings); addFilters(resource, where, predicates, bindings);
    const result = await createD1(env, { who: actorLabel(actor) }).prepare(`SELECT COUNT(*) AS count FROM ${quote(resource.table)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}`).bind(...bindings).first(); return Number(result?.count || 0);
  }

  async function writeInsert(name, requestedScope, values = {}) {
    const resource = getResource(name); const actor = await getContext(); assertWritable(resource, requestedScope, actor, "create"); const data = cleanWritableValues(resource, values, { includeId: true, includeOwnership: requestedScope === "system" }); assertColumnScopes(resource, actor, Object.keys(data)); addOwnedValue(resource, requestedScope, actor, data); const columns = Object.keys(data); if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);
    const result = await createD1(env, { who: actorLabel(actor) }).prepare(`INSERT INTO ${quote(resource.table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...columns.map((column) => data[column])).run(); const insertedId = data[resource.idColumn] === undefined ? result?.meta?.last_row_id : data[resource.idColumn]; return insertedId === undefined ? data : (await readList(name, requestedScope, { where: { [resource.idColumn]: insertedId }, limit: 1 }))[0] || { ...data, [resource.idColumn]: insertedId };
  }

  async function writeUpdate(name, requestedScope, id, changes = {}) {
    const resource = getResource(name); const actor = await getContext(); assertWritable(resource, requestedScope, actor, "update"); const data = cleanWritableValues(resource, changes, { includeOwnership: requestedScope === "system" }); assertColumnScopes(resource, actor, Object.keys(data)); const columns = Object.keys(data); if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);
    const predicates = [`${quote(resource.idColumn)}=?`]; const bindings = [id]; addScopePredicate(resource, requestedScope, actor, predicates, bindings); await createD1(env, { who: actorLabel(actor) }).prepare(`UPDATE ${quote(resource.table)} SET ${columns.map((column) => `${quote(column)}=?`).join(",")} WHERE ${predicates.join(" AND ")}`).bind(...columns.map((column) => data[column]), ...bindings).run(); return (await readList(name, requestedScope, { where: { [resource.idColumn]: id }, limit: 1 }))[0] || null;
  }

  async function writeDelete(name, requestedScope, id) { const resource = getResource(name); const actor = await getContext(); assertWritable(resource, requestedScope, actor, "delete"); const predicates = [`${quote(resource.idColumn)}=?`]; const bindings = [id]; addScopePredicate(resource, requestedScope, actor, predicates, bindings); return createD1(env, { who: actorLabel(actor) }).prepare(`DELETE FROM ${quote(resource.table)} WHERE ${predicates.join(" AND ")}`).bind(...bindings).run(); }

  async function writeUpdateWhere(name, requestedScope, where, changes) { const resource = getResource(name); const actor = await getContext(); assertWritable(resource, requestedScope, actor, "update"); const data = cleanWritableValues(resource, changes, { includeOwnership: requestedScope === "system" }); assertColumnScopes(resource, actor, Object.keys(data)); const columns = Object.keys(data); if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`); const predicates = []; const bindings = []; addScopePredicate(resource, requestedScope, actor, predicates, bindings); addFilters(resource, where, predicates, bindings); await createD1(env, { who: actorLabel(actor) }).prepare(`UPDATE ${quote(resource.table)} SET ${columns.map((column) => `${quote(column)}=?`).join(",")} WHERE ${predicates.join(" AND ")}`).bind(...columns.map((column) => data[column]), ...bindings).run(); return readCount(name, requestedScope, { where }); }

  async function writeDeleteWhere(name, requestedScope, where) { const resource = getResource(name); const actor = await getContext(); assertWritable(resource, requestedScope, actor, "delete"); const predicates = []; const bindings = []; addScopePredicate(resource, requestedScope, actor, predicates, bindings); addFilters(resource, where, predicates, bindings); return createD1(env, { who: actorLabel(actor) }).prepare(`DELETE FROM ${quote(resource.table)} WHERE ${predicates.join(" AND ")}`).bind(...bindings).run(); }
  function getResource(name) { const resource = registry.get(String(name)); if (!resource) throw new TypeError(`Unknown data resource: ${name}`); return resource; }
  return { user: scope("user"), tenant: scope("tenant"), public: scope("public"), system: scope("system"), context: getContext, resources: [...registry.values()] };
}

function isAllowed(resource, requestedScope, actor, operation) {
  const allowed = requestedScope === "system" ? Boolean(actor.system) : requestedScope === resource.scope && (requestedScope === "user" ? Boolean(actor.userId) : requestedScope === "public" ? Boolean(actor.publicTenantId && operation === "read") : Boolean(actor.tenantId && (actor.userId || (actor.public && resource.publicRead))));
  if (!allowed || !resource.operations.includes(operation)) { auditLog({ who: actorLabel(actor), operation: "deny", resource: `data:${resource.name}:${requestedScope}:${operation}` }); return false; }
  return true;
}
function assertWritable(resource, requestedScope, actor, operation) { if (!isAllowed(resource, requestedScope, actor, operation)) throw new DataScopeError(`Data scope ${requestedScope} cannot ${operation} resource ${resource.name}`); }
function assertColumnScopes(resource, actor, columns) { if (actor.system) return; for (const column of columns) { const required = resource.columnScopes[column] || []; if (required.some((scope) => !actor.scopes?.includes(scope))) throw new DataScopeError(`Missing scope to write ${resource.name}.${column}`); } }
function addScopePredicate(resource, requestedScope, actor, predicates, bindings) { if (requestedScope === "user") { predicates.push(`${quote(resource.ownerColumn)}=?`); bindings.push(actor.userId); } if (requestedScope === "public") { predicates.push(`${quote(resource.tenantColumn)}=?`); bindings.push(actor.publicTenantId); } if (requestedScope === "tenant") { predicates.push(`${quote(resource.tenantColumn)}=?`); bindings.push(actor.tenantId); if (actor.public && resource.publicRead && typeof resource.publicRead === "object") { predicates.push(`${quote(resource.publicRead.column)}=?`); bindings.push(resource.publicRead.value); } } }
function addFilters(resource, where, predicates, bindings) { for (const [column, value] of Object.entries(where || {})) { if (!resource.filterableColumns.includes(column)) throw new TypeError(`Column ${column} cannot filter ${resource.name}`); if (value === null) predicates.push(`${quote(column)} IS NULL`); else { predicates.push(`${quote(column)}=?`); bindings.push(value); } } }
function cleanWritableValues(resource, values, { includeId = false, includeOwnership = false } = {}) { return Object.fromEntries(Object.entries(values || {}).filter(([column]) => (resource.writableColumns.includes(column) || (includeOwnership && [resource.ownerColumn, resource.tenantColumn].includes(column))) && (includeId || column !== resource.idColumn))); }
function addOwnedValue(resource, requestedScope, actor, data) { if (requestedScope === "user") data[resource.ownerColumn] = actor.userId; if (requestedScope === "tenant") data[resource.tenantColumn] = actor.tenantId; }
function actorLabel(actor) { return actor.system ? "system:data" : `user:${actor.userId || "unknown"}`; }
function quote(identifier) { return `"${identifier}"`; }
