import { auditLog } from "../core/events/index.js";
import type {
  DataActorContext,
  DataOperation,
  DataResource,
  DataRow,
  DataScope,
} from "./model.js";
import { DataScopeError } from "./resources.js";

export function isAllowed(
  resource: DataResource,
  requestedScope: DataScope,
  actor: DataActorContext,
  operation: DataOperation,
): boolean {
  const scopeAllowed = requestedScope === "system"
    ? Boolean(actor.system)
    : requestedScope === resource.scope && (
      requestedScope === "user"
        ? Boolean(actor.userId)
        : requestedScope === "public"
          ? Boolean(actor.publicTenantId && operation === "read")
          : Boolean(actor.tenantId && (actor.userId || (actor.public && resource.publicRead)))
    );
  const requiredScopes = resource.operationScopes[operation] || [];
  const operationAllowed = actor.system
    || requiredScopes.every((scope) => actor.scopes?.includes(scope));
  if (!scopeAllowed || !resource.operations.includes(operation) || !operationAllowed) {
    auditLog({
      who: actorLabel(actor),
      operation: "deny",
      resource: `data:${resource.name}:${requestedScope}:${operation}`,
    });
    return false;
  }
  return true;
}

export function assertWritable(
  resource: DataResource,
  requestedScope: DataScope,
  actor: DataActorContext,
  operation: Extract<DataOperation, "create" | "update" | "delete">,
): void {
  if (!isAllowed(resource, requestedScope, actor, operation)) {
    throw new DataScopeError(`Data scope ${requestedScope} cannot ${operation} resource ${resource.name}`);
  }
}

export function assertColumnScopes(
  resource: DataResource,
  actor: DataActorContext,
  columns: readonly string[],
): void {
  if (actor.system) return;
  for (const column of columns) {
    const required = resource.columnScopes[column] || [];
    if (required.some((scope) => !actor.scopes?.includes(scope))) {
      throw new DataScopeError(`Missing scope to write ${resource.name}.${column}`);
    }
  }
}

export function addScopePredicate(
  resource: DataResource,
  requestedScope: DataScope,
  actor: DataActorContext,
  predicates: string[],
  bindings: unknown[],
): void {
  if (requestedScope === "user") {
    predicates.push(`${quote(resource.ownerColumn)}=?`);
    bindings.push(actor.userId);
  }
  if (requestedScope === "public") {
    predicates.push(`${quote(resource.tenantColumn)}=?`);
    bindings.push(actor.publicTenantId);
  }
  if (requestedScope === "tenant") {
    predicates.push(`${quote(resource.tenantColumn)}=?`);
    bindings.push(actor.tenantId);
    if (actor.public && resource.publicRead && typeof resource.publicRead === "object") {
      predicates.push(`${quote(resource.publicRead.column)}=?`);
      bindings.push(resource.publicRead.value);
    }
  }
}

export function addFilters(
  resource: DataResource,
  where: DataRow,
  predicates: string[],
  bindings: unknown[],
): void {
  for (const [column, value] of Object.entries(where || {})) {
    if (!resource.filterableColumns.includes(column)) {
      throw new TypeError(`Column ${column} cannot filter ${resource.name}`);
    }
    if (value === null) predicates.push(`${quote(column)} IS NULL`);
    else {
      predicates.push(`${quote(column)}=?`);
      bindings.push(value);
    }
  }
}

export function cleanWritableValues(
  resource: DataResource,
  values: DataRow,
  { includeId = false, includeOwnership = false } = {},
): DataRow {
  return Object.fromEntries(Object.entries(values || {}).filter(([column]) =>
    (
      resource.writableColumns.includes(column)
      || (includeOwnership && [resource.ownerColumn, resource.tenantColumn].includes(column))
    )
    && (includeId || column !== resource.idColumn)
  ));
}

export function addOwnedValue(
  resource: DataResource,
  requestedScope: DataScope,
  actor: DataActorContext,
  data: DataRow,
): void {
  if (requestedScope === "user") data[resource.ownerColumn] = actor.userId;
  if (requestedScope === "tenant") data[resource.tenantColumn] = actor.tenantId;
}

export function actorLabel(actor: DataActorContext): string {
  return actor.system ? "system:data" : `user:${actor.userId || "unknown"}`;
}

export function quote(identifier: string): string {
  return `"${identifier}"`;
}
