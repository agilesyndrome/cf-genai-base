import type { NewAuthTenant } from "./model.js";

const TENANT_ID = /^[a-z0-9][a-z0-9_-]*$/;

export function validateTenantId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!TENANT_ID.test(id)) throw new TypeError("Tenant id must contain lowercase letters, numbers, hyphens, or underscores.");
  return id;
}

export function validateTenantInput(value: unknown): NewAuthTenant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("A tenant object is required.");
  const input = value as Record<string, unknown>;
  const id = validateTenantId(input.id);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new TypeError("Tenant name is required.");
  return { id, name };
}

export function validateTenantIds(values: readonly unknown[]): string[] {
  return [...new Set(values.map(validateTenantId))];
}
