import { deleteTenantRow } from "./delete.js";
import { getTenantRow, insertTenantRow, listTenantRows, listTenantUserRows, listUserTenantRows, replaceUserTenantRows, updateTenantRow } from "./d1.js";
import { canManageTenants } from "./policy.js";
import { validateTenantId, validateTenantInput, validateTenantIds } from "./validation.js";
import type { TenantAuthorizationState, AuthTenant, TenantUser } from "./model.js";

export interface TenantServiceOptions {
  who?: string;
}

export function listTenants(env: unknown, options: TenantServiceOptions = {}): Promise<AuthTenant[]> {
  return listTenantRows(env, options);
}

export function listUserTenants(env: unknown, userId: string, options: TenantServiceOptions = {}): Promise<AuthTenant[]> {
  return listUserTenantRows(env, userId, options);
}

export function listTenantUsers(env: unknown, tenantId: unknown, options: TenantServiceOptions = {}): Promise<TenantUser[]> {
  return listTenantUserRows(env, validateTenantId(tenantId), options);
}

export function getTenant(env: unknown, tenantId: unknown, options: TenantServiceOptions = {}): Promise<AuthTenant | null> {
  return getTenantRow(env, validateTenantId(tenantId), options);
}

export function createTenant(env: unknown, input: unknown, options: TenantServiceOptions = {}): Promise<AuthTenant | null> {
  return insertTenantRow(env, validateTenantInput(input), options);
}

export function updateTenant(env: unknown, tenantId: unknown, name: unknown, options: TenantServiceOptions = {}): Promise<AuthTenant | null> {
  const id = validateTenantId(tenantId);
  const tenantName = typeof name === "string" ? name.trim() : "";
  if (!tenantName) throw new TypeError("Tenant name is required.");
  return updateTenantRow(env, id, tenantName, options);
}

export function deleteTenant(env: unknown, tenantId: unknown, options: TenantServiceOptions = {}): Promise<boolean> {
  return deleteTenantRow(env, validateTenantId(tenantId), options);
}

export function replaceUserTenants(env: unknown, userId: string, tenantIds: readonly unknown[], options: TenantServiceOptions = {}): Promise<AuthTenant[]> {
  return replaceUserTenantRows(env, userId, validateTenantIds(tenantIds), options);
}

export function assertTenantAdministrator(state: TenantAuthorizationState): void {
  if (!canManageTenants(state)) throw new Error("Administrator access is required.");
}
