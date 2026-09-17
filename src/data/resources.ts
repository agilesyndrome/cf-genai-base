import {
  DATA_OPERATIONS,
  DATA_SCOPES,
  type DataOperation,
  type DataResource,
  type DataResourceInput,
  type DataScope,
  type PublicReadPredicate,
} from "./model.js";

export { DATA_OPERATIONS, DATA_SCOPES } from "./model.js";
export type * from "./model.js";

export class DataScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataScopeError";
  }
}

/** Validate once at application composition time; query builders can then stay simple. */
export function normalizeDataResources(
  resources: readonly DataResourceInput[] = [],
): DataResource[] {
  const names = new Set<string>();
  return resources.map((resource) => normalizeDataResource(resource, names));
}

function normalizeDataResource(resource: DataResourceInput, names: Set<string>): DataResource {
  if (!resource || !/^[a-z][a-z0-9_-]*$/.test(String(resource.name || ""))) {
    throw new TypeError("Data resources require a safe name");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(String(resource.table || ""))) {
    throw new TypeError(`Data resource ${resource.name} requires a safe table name`);
  }
  const name = String(resource.name);
  if (names.has(name)) throw new TypeError(`Duplicate data resource: ${name}`);
  names.add(name);

  const scope = String(resource.scope || "").toLowerCase();
  if (!isDataScope(scope)) {
    throw new TypeError(`Data resource ${resource.name} requires scope user, tenant, public, or system`);
  }
  const columns = uniqueStrings(resource.columns || []);
  if (!columns.length || columns.some((column) => !safeIdentifier(column))) {
    throw new TypeError(`Data resource ${resource.name} requires safe columns`);
  }

  const idColumn = String(resource.idColumn || "id");
  if (!columns.includes(idColumn)) throw new TypeError(`Data resource ${resource.name} must include ${idColumn}`);
  const ownerColumn = String(resource.ownerColumn || "user_id");
  const tenantColumn = String(resource.tenantColumn || "tenant_id");
  if (scope === "user" && !columns.includes(ownerColumn)) {
    throw new TypeError(`User resource ${resource.name} must include ${ownerColumn}`);
  }
  if (["tenant", "public"].includes(scope) && !columns.includes(tenantColumn)) {
    throw new TypeError(`${scope} resource ${resource.name} must include ${tenantColumn}`);
  }

  const filterableColumns = uniqueStrings(resource.filterableColumns || columns);
  const orderableColumns = uniqueStrings(resource.orderableColumns || columns);
  for (const column of [...filterableColumns, ...orderableColumns]) {
    if (!columns.includes(column)) {
      throw new TypeError(`Data resource ${resource.name} references an unselected column`);
    }
  }
  const writableColumns = uniqueStrings(resource.writableColumns || [])
    .filter((column) => column !== ownerColumn && column !== tenantColumn);
  if (writableColumns.some((column) => !columns.includes(column))) {
    throw new TypeError(`Data resource ${resource.name} references an unwritable column`);
  }

  const columnScopes = Object.fromEntries(
    Object.entries(resource.columnScopes || {}).map(([column, scopes]) => [
      String(column),
      Array.isArray(scopes) ? scopes.map(String) : [String(scopes)],
    ]),
  );
  const invalidColumnScope = Object.entries(columnScopes).some(([column, scopes]) =>
    !columns.includes(column)
    || scopes.some((requiredScope) => !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(requiredScope))
  );
  if (invalidColumnScope) throw new TypeError(`Data resource ${resource.name} has invalid column scopes`);

  const operationScopes: Partial<Record<DataOperation, string[]>> = {};
  for (const [operation, scopes] of Object.entries(resource.operationScopes || {})) {
    const normalizedScopes = Array.isArray(scopes) ? uniqueStrings(scopes) : [String(scopes)];
    if (!isDataOperation(operation)
      || normalizedScopes.some((requiredScope) => !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(requiredScope))) {
      throw new TypeError(`Data resource ${resource.name} has invalid operation scopes`);
    }
    operationScopes[operation] = normalizedScopes;
  }

  if (!Array.isArray(resource.readableColumns) || !resource.readableColumns.length) {
    throw new TypeError(`Data resource ${resource.name} requires explicit readableColumns`);
  }
  const readableColumns = uniqueStrings(resource.readableColumns);
  if (readableColumns.some((column) => !columns.includes(column))) {
    throw new TypeError(`Data resource ${resource.name} references an unreadable column`);
  }

  const defaultOperations = ["read", ...(writableColumns.length ? ["create", "update", "delete"] : [])];
  const normalizedOperations = uniqueStrings(resource.operations || defaultOperations)
    .map((operation) => operation.toLowerCase());
  if (
    !normalizedOperations.length
    || normalizedOperations.some((operation) => !isDataOperation(operation))
    || !normalizedOperations.includes("read")
  ) throw new TypeError(`Data resource ${name} has invalid operations`);
  const operations: DataOperation[] = [];
  for (const operation of normalizedOperations) {
    if (isDataOperation(operation)) operations.push(operation);
  }

  const publicRead: boolean | PublicReadPredicate = resource.publicRead && typeof resource.publicRead === "object"
    ? { column: String(resource.publicRead.column || ""), value: resource.publicRead.value }
    : Boolean(resource.publicRead);
  if (
    publicRead && typeof publicRead === "object"
    && (!safeIdentifier(publicRead.column) || !columns.includes(publicRead.column))
  ) throw new TypeError(`Public resource ${resource.name} requires a selected visibility column`);

  return {
    ...resource,
    name,
    table: String(resource.table),
    scope,
    columns,
    readableColumns,
    idColumn,
    ownerColumn,
    tenantColumn,
    filterableColumns,
    orderableColumns,
    writableColumns,
    columnScopes,
    operationScopes,
    operations,
    publicRead,
  };
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(String))];
}

function safeIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

function isDataScope(value: string): value is DataScope {
  return DATA_SCOPES.some((scope) => scope === value);
}

function isDataOperation(value: string): value is DataOperation {
  return DATA_OPERATIONS.some((operation) => operation === value);
}
