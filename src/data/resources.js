export const DATA_SCOPES = ["user", "tenant", "public", "system"];
export const DATA_OPERATIONS = ["read", "create", "update", "delete"];

export class DataScopeError extends Error {
  constructor(message) { super(message); this.name = "DataScopeError"; }
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
    if (!DATA_SCOPES.includes(scope)) throw new TypeError(`Data resource ${resource.name} requires scope user, tenant, public, or system`);
    const columns = [...new Set((resource.columns || []).map(String))];
    if (!columns.length || columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) throw new TypeError(`Data resource ${resource.name} requires safe columns`);
    const idColumn = String(resource.idColumn || "id");
    if (!columns.includes(idColumn)) throw new TypeError(`Data resource ${resource.name} must include ${idColumn}`);
    const ownerColumn = resource.ownerColumn ? String(resource.ownerColumn) : "user_id";
    const tenantColumn = resource.tenantColumn ? String(resource.tenantColumn) : "tenant_id";
    if (scope === "user" && !columns.includes(ownerColumn)) throw new TypeError(`User resource ${resource.name} must include ${ownerColumn}`);
    if (["tenant", "public"].includes(scope) && !columns.includes(tenantColumn)) throw new TypeError(`${scope} resource ${resource.name} must include ${tenantColumn}`);
    const filterableColumns = [...new Set((resource.filterableColumns || columns).map(String))];
    const orderableColumns = [...new Set((resource.orderableColumns || columns).map(String))];
    for (const column of [...filterableColumns, ...orderableColumns]) if (!columns.includes(column)) throw new TypeError(`Data resource ${resource.name} references an unselected column`);
    const writableColumns = [...new Set((resource.writableColumns || []).map(String))].filter((column) => column !== ownerColumn && column !== tenantColumn);
    if (writableColumns.some((column) => !columns.includes(column))) throw new TypeError(`Data resource ${resource.name} references an unwritable column`);
    const columnScopes = Object.fromEntries(Object.entries(resource.columnScopes || {}).map(([column, scopes]) => [String(column), Array.isArray(scopes) ? scopes.map(String) : [String(scopes)]]));
    if (Object.keys(columnScopes).some((column) => !columns.includes(column) || columnScopes[column].some((scope) => !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(scope)))) throw new TypeError(`Data resource ${resource.name} has invalid column scopes`);
    if (!Array.isArray(resource.readableColumns) || !resource.readableColumns.length) throw new TypeError(`Data resource ${resource.name} requires explicit readableColumns`);
    const readableColumns = [...new Set(resource.readableColumns.map(String))];
    if (readableColumns.some((column) => !columns.includes(column))) throw new TypeError(`Data resource ${resource.name} references an unreadable column`);
    const operations = [...new Set((resource.operations || ["read", ...(writableColumns.length ? ["create", "update", "delete"] : [])]).map((operation) => String(operation).toLowerCase()))];
    if (!operations.length || operations.some((operation) => !DATA_OPERATIONS.includes(operation)) || !operations.includes("read")) throw new TypeError(`Data resource ${name} has invalid operations`);
    const publicRead = resource.publicRead && typeof resource.publicRead === "object" ? { column: String(resource.publicRead.column || ""), value: resource.publicRead.value } : Boolean(resource.publicRead);
    if (publicRead && typeof publicRead === "object" && (!/^[a-z][a-z0-9_]*$/.test(publicRead.column) || !columns.includes(publicRead.column))) throw new TypeError(`Public resource ${resource.name} requires a selected visibility column`);
    return { ...resource, name, table: String(resource.table), scope, columns, readableColumns, idColumn, ownerColumn, tenantColumn, filterableColumns, orderableColumns, writableColumns, columnScopes, operations, publicRead };
  });
}
